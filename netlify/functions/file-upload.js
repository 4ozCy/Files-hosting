const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const mv = promisify(fs.rename);

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, '/tmp/uploads/');
    },
    filename: (req, file, cb) => {
        const randomString = generateRandomString(4);
        const extension = path.extname(file.originalname);
        cb(null, `${randomString}${extension}`);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
}).single('file');

function generateRandomString(length) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
}

exports.handler = async (event, context) => {
    if (event.httpMethod === 'POST') {
        const buffer = Buffer.from(event.body, 'base64');
        const req = { body: buffer, headers: event.headers, queryStringParameters: event.queryStringParameters };
        const res = {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Unknown error' })
        };

        return new Promise((resolve, reject) => {
            upload(req, res, async (err) => {
                if (err) {
                    if (err.code === 'LIMIT_FILE_SIZE') {
                        res.statusCode = 400;
                        res.body = JSON.stringify({ error: 'File is too large. Maximum size is 10MB.' });
                    } else {
                        res.body = JSON.stringify({ error: 'File upload failed.' });
                    }
                    return resolve(res);
                }

                if (!req.file) {
                    res.statusCode = 400;
                    res.body = JSON.stringify({ error: 'No file uploaded.' });
                    return resolve(res);
                }

                const fileUrl = `https://${event.headers.host}/files/${req.file.filename}`;
                res.statusCode = 200;
                res.body = JSON.stringify({ fileUrl });
                resolve(res);
            });
        });
    } else {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method Not Allowed' })
        };
    }
};
