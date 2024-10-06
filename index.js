require('dotenv').config();
const express = require('express');
const multer = require('multer');
const { MongoClient, GridFSBucket } = require('mongodb');
const path = require('path');
const crypto = require('crypto');
const favicon = require('serve-favicon');
const app = express();
const PORT = process.env.PORT || 3000;

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
    limits: { fileSize: 1000 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|pdf|docx|txt|mp4|avi|mkv|zip|rar/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);

        if (extname && mimetype) {
            return cb(null, true);
        } else {
            cb(new Error('File type not allowed. Only images, documents, videos, and archives are allowed.'));
        }
    }
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
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).send('File is too large. Maximum size is 1GB.');
            } else if (err.message === 'File type not allowed. Only images, documents, videos, and archives are allowed.') {
                return res.status(400).send(err.message);
            }
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

app.post('/api/file/hosting', (req, res) => {
    upload(req, res, (err) => {
        if (err) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ error: 'File is too large. Maximum size is 1GB.' });
            } else if (err.message === 'File type not allowed. Only images, documents, videos, and archives are allowed.') {
                return res.status(400).json({ error: err.message });
            }
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

        uploadStream.on('error', () => {
            res.status(500).json({ error: 'File upload failed.' });
        });
    });
});

app.get('/file/:filename', (req, res) => {
    const downloadStream = bucket.openDownloadStreamByName(req.params.filename);
    downloadStream.pipe(res).on('error', () => {
        res.status(404).send('File not found');
    });
    downloadStream.on('error', (err) => {
        console.error('Error streaming file:', err);
        res.status(500).send('Error retrieving file.');
    });
});
