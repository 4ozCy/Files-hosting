require('dotenv').config();
const express = require('express');
const multer = require('multer');
const { MongoClient, GridFSBucket } = require('mongodb');
const path = require('path');
const crypto = require('crypto');
const favicon = require('serve-favicon');
const axios = require('axios');
const useragent = require('express-useragent');
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
    limits: { fileSize: 90000 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|mp4|avi/;
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
app.use(useragent.express());

app.set('trust proxy', true);

function sendDiscordNotification(fileDetails, req) {
    const { filename, fileUrl, fileSize } = fileDetails || {};
    const browserInfo = req.useragent.browser;
    const osInfo = req.useragent.os;
    const ipAddress = req.headers['x-forwarded-for'] || req.ip;
    const deviceType = req.useragent.isMobile ? 'Mobile' : req.useragent.isTablet ? 'Tablet' : 'Desktop';

    const locationApiUrl = `https://ipinfo.io/${ipAddress}/json?token=${process.env.TOKEN}`;

    axios.get(locationApiUrl)
        .then(response => {
            const location = response.data;
            const city = location.city || 'Unknown';
            const region = location.region || 'Unknown';
            const country = location.country || 'Unknown';
            const locationString = `${city}, ${region}, ${country}`;

            const message = {
                content: "New file upload request received!",
                embeds: [{
                    title: "File Upload Request Information",
                    fields: [
                        { name: "Filename", value: filename, inline: true },
                        { name: "File URL", value: fileUrl, inline: true },
                        { name: "File Size", value: `${fileSize} bytes`, inline: true },
                        { name: "Upload Time", value: new Date().toLocaleString(), inline: false },
                        { name: "IP Address", value: ipAddress, inline: true },
                        { name: "Browser", value: browserInfo, inline: true },
                        { name: "Operating System", value: osInfo, inline: true },
                        { name: "Device", value: deviceType, inline: true },
                        { name: "Location", value: locationString, inline: true }
                    ],
                }],
                username: 'File Upload'
            };

            axios.post(process.env.WEBHOOK, message)
                .then(() => {
                    console.log('Notification sent to Discord');
                })
                .catch((error) => {
                    console.error('Error sending Discord notification:', error);
                });
        })
        .catch(error => {
            console.error('Error fetching location data:', error);
        });
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/file', (req, res) => {
    if (!bucket) {
        return res.status(500).send('Database not connected.');
    }

    sendDiscordNotification(null, req);

    upload(req, res, (err) => {
        if (err) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).send('File is too large. Maximum size is 9GB.');
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
            const fileDetails = {
                filename: filename,
                fileUrl: fileUrl,
                fileSize: req.file.size
            };

            sendDiscordNotification(fileDetails, req);
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

    sendDiscordNotification(null, req);

    upload(req, res, (err) => {
        if (err) {
            console.error('Error during file upload:', err.message);
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ error: 'File is too large. Maximum size is 9GB.' });
            } else if (err.message === 'File type not allowed. Only images and videos are allowed.') {
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
            const fileDetails = {
                filename: filename,
                fileUrl: fileUrl,
                fileSize: req.file.size
            };

            sendDiscordNotification(fileDetails, req);
            res.json({ fileUrl });
        });

        uploadStream.on('error', (error) => {
            console.error('Error uploading file:', error);
            res.status(500).json({ error: 'File upload failed.' });
        });
    });
});

app.get('/file/:filename', (req, res) => {
    const downloadStream = bucket.openDownloadStreamByName(req.params.filename);

    downloadStream.pipe(res).on('error', (err) => {
        console.error('Error streaming file:', err);
        res.status(500).send('Error retrieving file.');
    });

    downloadStream.on('end', () => {
        console.log(`File ${req.params.filename} sent successfully`);
    });
});
