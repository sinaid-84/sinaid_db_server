// db.js

const mongoose = require('mongoose');
require('dotenv').config();

const connectDB = async () => {
    try {
        const mongoURI = process.env.MONGO_URI;
        await mongoose.connect(mongoURI, {
            useNewUrlParser: true, // Mongoose 6 이상에서는 기본값
            useUnifiedTopology: true // Mongoose 6 이상에서는 기본값
        });
        console.log('MongoDB에 성공적으로 연결되었습니다.');
    } catch (error) {
        console.error('MongoDB 연결 오류:', error);
        process.exit(1); // 연결 실패 시 프로세스 종료
    }
};

module.exports = connectDB;
