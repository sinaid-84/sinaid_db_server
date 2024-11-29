// server.js

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');
const session = require('express-session');
const bcrypt = require('bcryptjs'); // 'bcrypt' 대신 'bcryptjs' 사용
const bodyParser = require('body-parser');
const mongoose = require('mongoose'); // mongoose 추가
const fs = require('fs'); // 파일 시스템 모듈
require('dotenv').config(); // dotenv 설정

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*", // 개발 단계에서는 모든 출처를 허용, 프로덕션에서는 특정 도메인으로 제한하는 것이 좋습니다.
        methods: ["GET", "POST"],
        credentials: true
    }
});
const PORT = process.env.PORT || 5000;

// MongoDB 연결 설정
const mongoURI = process.env.MONGODB_URI || 'mongodb://sinaid:052929@svc.sel4.cloudtype.app:31003';

mongoose.connect(mongoURI)
    .then(() => console.log('MongoDB에 성공적으로 연결되었습니다.'))
    .catch(err => console.error('MongoDB 연결 오류:', err));

// 클라이언트 스키마 및 모델 정의
const clientSchema = new mongoose.Schema({
    username: String,
    address: String,
    server_status: String,
    isApproved: { type: Boolean, default: false },
    cumulativeProfit: { type: Number, default: 0 },
    targetProfit: { type: Number, default: 500 },
    goalAchieved: { type: Boolean, default: false },
    socketId: String, // 소켓 ID 저장
    timestamp: { type: Date, default: Date.now }
});

const Client = mongoose.model('Client', clientSchema);

// CORS 설정
app.use(cors());

// 세션 설정
app.use(session({
    secret: process.env.SESSION_SECRET || 'your_secret_key',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false, // 프로덕션 환경에서는 true로 설정
        httpOnly: true,
        maxAge: 60 * 60 * 1000 // 1시간 유효
    }
}));

// Body Parser 설정
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// 정적 파일 서빙
app.use(express.static(path.join(__dirname, 'public')));

// 비밀번호 설정 및 해싱
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "your_admin_password";
const hashedPassword = bcrypt.hashSync(ADMIN_PASSWORD, 10);

// 인증 미들웨어
function isAuthenticated(req, res, next) {
    if (req.session.isAuthenticated) {
        next();
    } else {
        res.redirect('/login'); // 메인 페이지로 리디렉션
    }
}

// 메인 루트 라우트
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 로그인 페이지 라우트
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// 로그인 처리 라우트
app.post('/login', (req, res) => {
    const { password } = req.body;
    if (bcrypt.compareSync(password, hashedPassword)) {
        req.session.isAuthenticated = true;
        console.log('로그인 성공: 세션 설정 완료');
        res.redirect('/dashboard');
    } else {
        console.log('로그인 실패: 비밀번호 불일치');
        // 로그인 실패 시, 다시 로그인 페이지로 리디렉션하면서 에러 메시지 전달
        res.send(`
            <script>
                alert('비밀번호가 일치하지 않습니다.');
                window.location.href = '/login';
            </script>
        `);
    }
});

// 로그아웃 라우트
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.redirect('/dashboard');
        }
        res.redirect('/');
    });
});

// 대시보드 라우트 보호
app.get('/dashboard', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// 추가된 대시보드 내 페이지 라우트 보호
app.get('/dashboard/user-management', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'user-management.html'));
});

app.get('/dashboard/settings', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'settings.html'));
});

app.get('/dashboard/reports', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'reports.html'));
});

// 클라이언트 상태를 저장하기 위한 객체
const clients = {};

// 목표 달성한 클라이언트를 저장할 배열 (데이터베이스로 대체)

// Socket.IO 이벤트 핸들링
io.on('connection', (socket) => {
    console.log('클라이언트가 연결되었습니다.');

    // 클라이언트가 처음 연결되었을 때 데이터베이스에서 기존 데이터 로드
    socket.on('user_info_update', async (data) => {
        console.log('사용자 정보 업데이트:', data);

        // 데이터베이스에서 해당 클라이언트를 찾거나 새로운 클라이언트 생성
        let client = await Client.findOne({ username: data.name });

        if (!client) {
            client = new Client({
                username: data.name,
                address: data.user_ip,
                server_status: data.server_status,
                socketId: socket.id,
                isApproved: false, // 초기 승인 상태는 false
                cumulativeProfit: 0, // 초기 누적 수익금은 0
                targetProfit: 500, // 초기 목표 수익금은 500
                goalAchieved: false // 초기 목표 달성 상태는 false
            });
            await client.save();
        } else {
            // 기존 클라이언트의 소켓 ID와 서버 상태 업데이트
            client.socketId = socket.id;
            client.server_status = data.server_status;
            await client.save();
        }

        // 클라이언트 정보를 메모리에도 저장
        clients[client.username] = {
            ...client._doc,
            socket: socket
        };

        // 웹페이지에 사용자 정보 전송
        io.emit('update_user_info', {
            name: client.username,
            user_ip: client.address,
            server_status: client.server_status,
            timestamp: new Date().toISOString().slice(0, 19).replace('T', ' ')
        });
    });

    // 'cumulative_profit' 이벤트 처리
    socket.on('cumulative_profit', async (data) => {
        const { cumulativeProfit: clientProfit } = data;
        if (typeof clientProfit === 'number' && clientProfit >= 0 && clientProfit < 1e12) {
            const client = await Client.findOne({ socketId: socket.id });
            if (client) {
                client.cumulativeProfit += clientProfit;
                await client.save();
                console.log(`클라이언트 ${client.username}로부터 누적 수익금 수신: ${clientProfit} USDT`);
                console.log(`클라이언트 ${client.username}의 전체 누적 수익금: ${client.cumulativeProfit} USDT`);

                // 대시보드에 누적 수익금 업데이트 전송
                io.emit('update_cumulative_profit', { name: client.username, cumulativeProfit: client.cumulativeProfit });

                // 목표 수익금과 비교
                if (client.cumulativeProfit >= client.targetProfit && !client.goalAchieved) {
                    console.log(`클라이언트 ${client.username}의 목표 수익금 달성!`);

                    // 목표 달성 상태 업데이트
                    client.goalAchieved = true;
                    await client.save();

                    // 대시보드에 목표 달성 이벤트 전송
                    io.emit('goal_achieved', { name: client.username });

                    // "목표를 달성했습니다" 메시지 전송
                    io.emit('show_goal_message', { name: client.username, message: '목표를 달성했습니다' });
                }
            } else {
                console.log('누적 수익금 수신: 클라이언트 정보가 존재하지 않습니다.');
            }
        } else {
            console.log('잘못된 누적 수익금 데이터 수신:', data);
        }
    });

    // 'set_target_profit' 이벤트 처리
    socket.on('set_target_profit', async (data, callback) => {
        const { name, targetProfit } = data;
        if (typeof targetProfit === 'number' && targetProfit > 0) {
            const client = await Client.findOne({ username: name });
            if (client) {
                client.targetProfit = targetProfit;
                client.goalAchieved = false; // 목표 달성 상태 리셋
                await client.save();
                console.log(`클라이언트 ${name}의 목표 수익금이 ${targetProfit} USDT로 설정되었습니다.`);

                // 대시보드에 목표 수익금 업데이트 전송
                io.emit('update_target_profit', { name: name, targetProfit: targetProfit });

                // 콜백으로 성공 응답 전송
                if (callback && typeof callback === 'function') {
                    callback({ status: 'success' });
                }
            } else {
                console.log(`목표 수익금 설정: 클라이언트 ${name}을(를) 찾을 수 없습니다.`);
                if (callback && typeof callback === 'function') {
                    callback({ status: 'error', message: `클라이언트 ${name}을(를) 찾을 수 없습니다.` });
                }
            }
        } else {
            console.log('잘못된 목표 수익금 데이터 수신:', data);
            if (callback && typeof callback === 'function') {
                callback({ status: 'error', message: 'Invalid targetProfit value.' });
            }
        }
    });

    // 'keep_alive' 이벤트 처리
    socket.on('keep_alive', (data) => {
        console.log(`클라이언트 ${data.name}로부터 keep_alive 수신`);
        // 필요한 경우 추가 처리
    });

    // 'update_data' 이벤트 처리
    socket.on('update_data', async (data) => {
        console.log('받은 데이터:', data);

        // 데이터베이스에서 클라이언트 정보 업데이트
        let client = await Client.findOne({ username: data.name });

        if (client) {
            client.total_balance = data.total_balance || client.total_balance;
            client.current_profit_rate = data.current_profit_rate || client.current_profit_rate;
            client.unrealized_pnl = data.unrealized_pnl || client.unrealized_pnl;
            client.current_total_asset = data.current_total_asset || client.current_total_asset;
            client.server_status = data.server_status || client.server_status;
            client.timestamp = new Date();
            await client.save();

            // 메모리의 클라이언트 정보도 업데이트
            clients[client.username] = {
                ...client._doc,
                socket: socket
            };
        } else {
            // 클라이언트 정보가 없으면 생성
            client = new Client({
                username: data.name,
                address: data.user_ip,
                server_status: data.server_status,
                socketId: socket.id,
                isApproved: false, // 초기 승인 상태는 false
                cumulativeProfit: 0, // 초기 누적 수익금은 0
                targetProfit: 500, // 초기 목표 수익금은 500
                goalAchieved: false // 초기 목표 달성 상태는 false
            });
            await client.save();

            // 메모리에 저장
            clients[client.username] = {
                ...client._doc,
                socket: socket
            };
        }

        // 소수점 두 자리로 반올림
        const roundedData = { ...data };

        // 소수점 두 자리로 반올림할 필드 목록
        const numericFields = ['total_balance', 'current_profit_rate', 'unrealized_pnl', 'current_total_asset'];

        numericFields.forEach(field => {
            if (typeof roundedData[field] === 'number') {
                roundedData[field] = parseFloat(roundedData[field].toFixed(2));
            } else {
                roundedData[field] = null;  // 데이터가 없을 경우 null로 설정
            }
        });

        // 'target_profit'을 제외하고 브로드캐스트
        delete roundedData.target_profit;

        // 모든 클라이언트에게 데이터 브로드캐스트
        io.emit('update_data', roundedData);
    });

    // 클라이언트로부터 승인 또는 승인취소 명령을 수신
    socket.on('send_command', async (data) => {
        const { command, name } = data;
        // 데이터베이스에서 해당 클라이언트를 찾습니다.
        const client = await Client.findOne({ username: name });

        if (client) {
            // 승인 상태 업데이트
            if (command === 'approve') {
                client.isApproved = true;
            } else if (command === 'cancel_approve') {
                client.isApproved = false;
                // 목표 달성 상태 리셋
                client.goalAchieved = false;
            }
            await client.save();

            // 메모리의 클라이언트 정보도 업데이트
            clients[client.username] = {
                ...client._doc,
                socket: clients[client.username] ? clients[client.username].socket : null
            };

            // 해당 클라이언트에게 명령 전송
            if (clients[client.username].socket) {
                clients[client.username].socket.emit(command, { message: `${command} 명령이 서버에서 전송되었습니다.` });
                console.log(`클라이언트 ${name}에게 ${command} 명령을 전송했습니다.`);
            }

            // 모든 클라이언트에게 승인 상태 업데이트 전송
            io.emit('update_approval_status', { name: client.username, isApproved: client.isApproved });
        } else {
            console.log(`클라이언트 ${name}을(를) 찾을 수 없습니다.`);
        }
    });

    // 클라이언트 연결 해제 시
    socket.on('disconnect', async () => {
        console.log('클라이언트 연결이 해제되었습니다.');

        // 데이터베이스에서 해당 클라이언트의 서버 상태를 업데이트
        const client = await Client.findOne({ socketId: socket.id });
        if (client) {
            client.server_status = 'Disconnected';
            await client.save();

            // 메모리에서 클라이언트 정보 삭제
            delete clients[client.username];

            // 웹페이지에 사용자 상태 업데이트
            const disconnectData = {
                name: client.username,
                user_ip: client.address,
                server_status: 'Disconnected',
                timestamp: new Date().toISOString().slice(0, 19).replace('T', ' ')
            };
            io.emit('update_user_info', disconnectData);
        }
    });

    // 'request_initial_data' 이벤트 처리
    socket.on('request_initial_data', async () => {
        // 데이터베이스에서 모든 클라이언트 데이터를 가져옵니다.
        const allClients = await Client.find({});
        const allUserData = allClients.map(client => ({
            name: client.username,
            user_ip: client.address,
            total_balance: client.total_balance || 0,
            current_profit_rate: client.current_profit_rate || 0,
            unrealized_pnl: client.unrealized_pnl || 0,
            current_total_asset: client.current_total_asset || 0,
            cumulative_profit: client.cumulativeProfit,
            target_profit: client.targetProfit,
            server_status: client.server_status,
            isApproved: client.isApproved,
            timestamp: client.timestamp ? client.timestamp.toISOString().slice(0, 19).replace('T', ' ') : ''
        }));

        socket.emit('initial_data', allUserData);
    });
});

// 서버 시작
server.listen(PORT, () => {
    console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
});
