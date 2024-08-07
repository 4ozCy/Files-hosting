const express = require('express');
const multer = require('multer');
const { MongoClient, GridFSBucket } = require('mongodb');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;
require('dotenv').config();

const client = new MongoClient(process.env.MONGODB_URL, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
});

let bucket;

client.connect().then(() => {
    const db = client.db();
    bucket = new GridFSBucket(db, {
        bucketName: 'uploads'
    });
});

function generateRandomString(length) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
}

const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 150 * 1024 * 1024 },
}).single('file');

app.use(express.static('public'));

app.post('/file', (req, res) => {
    upload(req, res, (err) => {
        if (err) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).send('File is too large. Maximum size is 150MB.');
            }
            return res.status(500).send('File upload failed.');
        }
        if (!req.file) {
            return res.status(400).send('No file uploaded.');
        }

        const filename = `${generateRandomString(6)}${path.extname(req.file.originalname)}`;
        const uploadStream = bucket.openUploadStream(filename);
        uploadStream.end(req.file.buffer, () => {
            const fileUrl = `${req.protocol}://${req.get('host')}/file/${filename}`;
            res.send({ fileUrl });
        });
    });
});

app.get('/file/:filename', (req, res) => {
    const downloadStream = bucket.openDownloadStreamByName(req.params.filename);
    downloadStream.pipe(res).on('error', () => {
        res.status(404).send('File not found');
    });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
