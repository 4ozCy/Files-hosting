require('dotenv').config();
const express = require('express');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');
const favicon = require('serve-favicon');
const app = express();
const PORT = process.env.PORT || 3000;

const db = new sqlite3.Database('files.db', (err) => {
    if (err) {
        console.error('Database opening error: ', err);
    }
});

db.serialize(() => {
    db.run('CREATE TABLE IF NOT EXISTS files (id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)');
});

function generateRandomString(length) {
    return crypto.randomBytes(length).toString('hex').slice(0, length);
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        const filename = `${generateRandomString(5)}${path.extname(file.originalname)}`;
        cb(null, filename);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 90000 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|mp4|avi|mkv|webm/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);

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
    upload(req, res, (err) => {
        if (err) {
            return res.status(400).send(err.message);
        }
        if (!req.file) {
            return res.status(400).send('No file uploaded.');
        }

        const { filename, mimetype, size } = req.file;

        db.run('INSERT INTO files (filename, content_type, size) VALUES (?, ?, ?)', [filename, mimetype, size], function(err) {
            if (err) {
                return res.status(500).send('Database error.');
            }
            const fileUrl = `${req.protocol}://${req.get('host')}/file/${filename}`;
            res.send({ fileUrl });
        });
    });
});

app.get('/file/:filename', (req, res) => {
    db.get('SELECT * FROM files WHERE filename = ?', [req.params.filename], (err, file) => {
        if (!file) {
            return res.status(404).send('File not found.');
        }

        const fileType = path.extname(file.filename).toLowerCase();
        let contentType;

        switch (fileType) {
            case '.mp4':
                contentType = 'video/mp4';
                break;
            case '.avi':
                contentType = 'video/x-msvideo';
                break;
            case '.mkv':
                contentType = 'video/x-matroska';
                break;
            case '.webm':
                contentType = 'video/webm';
                break;
            default:
                return res.status(400).send('Unsupported media type.');
        }

        res.set('Content-Type', contentType);
        const filePath = path.join(__dirname, 'uploads', file.filename);

        res.download(filePath, file.filename, (err) => {
            if (err) {
                res.status(500).send('Error retrieving file.');
            }
        });
    });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
