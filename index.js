require('dotenv').config();
const express = require('express');
const multer = require('multer');
const { MongoClient, GridFSBucket } = require('mongodb');
const path = require('path');
const crypto = require('crypto');
const favicon = require('serve-favicon');
const app = express();
const PORT = process.env.PORT || 8080;

const client = new MongoClient(process.env.MONGODB_URL, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
});

let bucket;

client.connect().then(() => {
    const db = client.db();
    bucket = new GridFSBucket(db, { bucketName: 'uploads' });

    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}).catch(err => {
    console.error('Failed to connect to MongoDB', err);
    process.exit(1);
});

function generateRandomString(length) {
    return crypto.randomBytes(length).toString('hex').slice(0, length);
}

const storage = multer.memoryStorage();

const upload = multer({
    storage: storage,
    limits: { fileSize: Infinity },
}).single('file');

app.use(express.static('public'));
app.use(favicon(path.join(__dirname, 'favicon.ico')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/file', (req, res) => {
    if (!bucket) {
        return res.status(500).send('Database not connected.');
    }

    upload(req, res, (err) => {
        if (err) {
            return res.status(500).send('File upload failed.');
        }
        if (!req.file) {
            return res.status(400).send('No file uploaded.');
        }

        const filename = `${generateRandomString(5)}${path.extname(req.file.originalname)}`;
        const uploadStream = bucket.openUploadStream(filename);
        uploadStream.end(req.file.buffer, () => {
            const fileUrl = `${req.protocol}://${req.get('host')}/file/${filename}`;
            res.send({ fileUrl });
        });

        uploadStream.on('error', () => {
            res.status(500).send('File upload failed.');
        });
    });
});

app.post('/api/file', (req, res) => {
    if (!bucket) {
        return res.status(500).json({ error: 'Database not connected.' });
    }

    upload(req, res, (err) => {
        if (err) {
            return res.status(500).json({ error: 'File upload failed.' });
        }

        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded.' });
        }

        const filename = `${generateRandomString(5)}${path.extname(req.file.originalname)}`;
        const uploadStream = bucket.openUploadStream(filename);

        uploadStream.end(req.file.buffer, () => {
            const fileUrl = `${req.protocol}://${req.get('host')}/file/${filename}`;
            res.json({ fileUrl });
        });

        uploadStream.on('error', (error) => {
            res.status(500).json({ error: 'File upload failed.' });
        });
    });
});

app.get('/file/:filename', (req, res) => {
    const downloadStream = bucket.openDownloadStreamByName(req.params.filename);

    downloadStream.pipe(res).on('error', (err) => {
        res.status(500).send('Error retrieving file.');
    });

    downloadStream.on('end', () => {
        console.log(`File ${req.params.filename} sent successfully`);
    });
});
