require('dotenv').config();
const express = require('express');
const multer = require('multer');
const { MongoClient, GridFSBucket } = require('mongodb');
const path = require('path');
const crypto = require('crypto');
const favicon = require('serve-favicon');
const fs = require('fs');
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

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = 'uploads/';
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        const filename = `${generateRandomString(5)}${path.extname(file.originalname)}`;
        cb(null, filename);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 15000 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|mp4|avi|mov|mkv|webm|wmv|hevc|h265/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = /image\/jpeg|image\/png|image\/gif|video\/mp4|video\/avi|video\/quicktime|video\/x-matroska|video\/webm|video\/x-ms-wmv|video\/hevc/.test(file.mimetype);

        if (extname && mimetype) {
            return cb(null, true);
        } else {
            cb(new Error('File type not allowed. Only images and videos are allowed.'));
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
                return res.status(400).send('File is too large. Maximum size is 15GB.');
            } else if (err.message === 'File type not allowed. Only images and videos are allowed.') {
                return res.status(400).send(err.message);
            }
            return res.status(500).send('File upload failed.');
        }
        if (!req.file) {
            return res.status(400).send('No file uploaded.');
        }

        const filename = req.file.filename;
        const uploadStream = bucket.openUploadStream(filename);
        const fileReadStream = fs.createReadStream(req.file.path);

        fileReadStream.pipe(uploadStream).on('error', (error) => {
            console.error('Error during file upload:', error);
            return res.status(500).send('File upload failed.');
        });

        uploadStream.on('finish', () => {
            fs.unlinkSync(req.file.path);

            const fileUrl = `${req.protocol}://${req.get('host')}/file/${filename}`;
            res.send({ fileUrl });
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

app.post('/api/file', (req, res) => {
    if (!bucket) {
        return res.status(500).json({ error: 'Database not connected.' });
    }

    upload(req, res, (err) => {
        if (err) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ error: 'File is too large. Maximum size is 15GB.' });
            } else if (err.message === 'File type not allowed. Only images and videos are allowed.') {
                return res.status(400).json({ error: err.message });
            }
            return res.status(500).json({ error: 'File upload failed.' });
        }

        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded.' });
        }

        const filename = req.file.filename;
        const uploadStream = bucket.openUploadStream(filename);
        const fileReadStream = fs.createReadStream(req.file.path);

        fileReadStream.pipe(uploadStream).on('error', (error) => {
            console.error('Error during file upload:', error);
            return res.status(500).json({ error: 'File upload failed.' });
        });

        uploadStream.on('finish', () => {
            fs.unlinkSync(req.file.path);

            const fileUrl = `${req.protocol}://${req.get('host')}/file/${filename}`;
            res.json({ fileUrl });
        });
    });
});
