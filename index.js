const express = require('express');
const multer = require('multer');
const { MongoClient, GridFSBucket } = require('mongodb');
const path = require('path');
const fs = require('fs');
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

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'temp-uploads');
    },
    filename: function (req, file, cb) {
        cb(null, generateRandomString(6) + path.extname(file.originalname));
    }
});
const upload = multer({
    storage: storage,
    limits: { fileSize: 150 * 1024 * 1024 },
});

app.use(express.static('public'));

app.post('/file', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

    const filename = req.file.filename;
    const uploadStream = bucket.openUploadStream(filename);

    fs.createReadStream(`temp-uploads/${filename}`).pipe(uploadStream).on('finish', () => {
        fs.unlinkSync(`temp-uploads/${filename}`);
        const fileUrl = `${req.protocol}://${req.get('host')}/file/${filename}`;
        res.send({ fileUrl });
    }).on('error', () => {
        res.status(500).send('File upload failed.');
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
