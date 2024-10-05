require('dotenv').config();
const express = require('express');
const multer = require('multer');
const { MongoClient, GridFSBucket } = require('mongodb');
const path = require('path');
const crypto = require('crypto');
const favicon = require('serve-favicon');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const app = express();

const PORT = process.env.PORT || 3000;
const MAX_FILE_SIZE = process.env.MAX_FILE_SIZE || 1000 * 1024 * 1024;

if (!process.env.MONGODB_URL) {
    console.error('Missing required environment variables. Ensure MONGODB_URL is set.');
    process.exit(1);
}

const client = new MongoClient(process.env.MONGODB_URL, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
});

let bucket;

(async () => {
    try {
        await client.connect();
        const db = client.db();
        bucket = new GridFSBucket(db, { bucketName: 'uploads' });
        console.log('Connected to MongoDB');
    } catch (err) {
        console.error('Failed to connect to MongoDB', err);
        process.exit(1);
    }
})();

app.use(express.static('public'));
app.use(favicon(path.join(__dirname, 'favicon.ico')));
app.use(cors());

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
});
app.use(limiter);

function generateRandomString(length) {
    return crypto.randomBytes(length).toString('hex').slice(0, length);
}

const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|pdf|docx|txt|mp4|avi|mkv|zip|rar/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);

        if (extname && mimetype) {
            cb(null, true);
        } else {
            cb(new Error('File type not allowed. Only images, documents, videos, and archives are allowed.'));
        }
    },
}).single('file');

app.post('/file', async (req, res, next) => {
    upload(req, res, async (err) => {
        if (err) {
            return handleUploadError(err, res);
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

        uploadStream.on('error', (uploadErr) => {
            console.error('File upload error:', uploadErr);
            res.status(500).send('File upload failed.');
        });
    });
});

app.post('/api/file/hosting', async (req, res) => {
    upload(req, res, async (err) => {
        if (err) {
            return handleUploadErrorJSON(err, res);
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

        uploadStream.on('error', (uploadErr) => {
            console.error('File upload error:', uploadErr);
            res.status(500).json({ error: 'File upload failed.' });
        });
    });
});

app.get('/file/:filename', (req, res) => {
    const downloadStream = bucket.openDownloadStreamByName(req.params.filename);

    downloadStream.on('error', (err) => {
        console.error('Error streaming file:', err);
        res.status(500).send('Error retrieving file.');
    });

    downloadStream.pipe(res);
});

function handleUploadError(err, res) {
    if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).send('File is too large. Maximum size is 1GB.');
    } else if (err.message === 'File type not allowed. Only images, documents, videos, and archives are allowed.') {
        return res.status(400).send(err.message);
    }
    return res.status(500).send('File upload failed.');
}

function handleUploadErrorJSON(err, res) {
    if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File is too large. Maximum size is 1GB.' });
    } else if (err.message === 'File type not allowed. Only images, documents, videos, and archives are allowed.') {
        return res.status(400).json({ error: err.message });
    }
    return res.status(500).json({ error: 'File upload failed.' });
}

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
