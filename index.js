require('dotenv').config();
const express = require('express');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const favicon = require('serve-favicon');
const mime = require('mime-types');
const app = express();
const PORT = process.env.PORT || 3000;

const uploadsDir = path.join(__dirname, 'Uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

const db = new sqlite3.Database('./files.sqlite', (err) => {
  if (err) process.exit(1);
  db.run(`
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      filedata BLOB NOT NULL,
      filepath TEXT,
      upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

function generateRandomString(length) {
  return crypto.randomBytes(length).toString('hex').slice(0, length);
}

const upload = multer({
  limits: { fileSize: 90000 * 1024 * 1024 },
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|mp4|avi|mov|mkv/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) cb(null, true);
    else cb(new Error('File type not allowed.'));
  }
}).single('file');

app.use(express.static('public'));
app.use(favicon(path.join(__dirname, 'favicon.ico')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/file', (req, res) => {
  upload(req, res, (err) => {
    if (err) return res.status(400).send(err.message);
    if (!req.file) return res.status(400).send('No file uploaded.');
    const uniqueFilename = `${generateRandomString(5)}${path.extname(req.file.originalname)}`;
    const filepath = path.join(uploadsDir, uniqueFilename);
    fs.writeFileSync(filepath, req.file.buffer);
    const query = `INSERT INTO files (filename, filedata, filepath) VALUES (?, ?, ?)`;
    db.run(query, [uniqueFilename, req.file.buffer, filepath], function(err) {
      if (err) return res.status(500).send('Failed to store file metadata.');
      const fileUrl = `https://${req.get('host')}/${uniqueFilename}`;
      res.send({ fileUrl });
    });
  });
});

app.get('/:filename', (req, res) => {
  const filename = req.params.filename;
  const query = 'SELECT filedata FROM files WHERE filename = ?';
  db.get(query, [filename], (err, row) => {
    if (err) return res.status(500).send('Database error.');
    if (!row) return res.status(404).send('File not found.');
    const fileBuffer = row.filedata;
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes = {
      '.mp4': 'video/mp4',
      '.mov': 'video/quicktime',
      '.avi': 'video/x-msvideo',
      '.mkv': 'video/x-matroska',
      '.jpeg': 'image/jpeg',
      '.jpg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif'
    };
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    const fileSize = fileBuffer.length;
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = (end - start) + 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType
      });
      res.end(fileBuffer.slice(start, end + 1));
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': contentType
      });
      res.end(fileBuffer);
    }
  });
});

setInterval(() => {
  const expiryDays = 30;
  const expiryDate = new Date(Date.now() - expiryDays * 24 * 60 * 60 * 1000);
  db.all(`SELECT * FROM files WHERE upload_date < ?`, [expiryDate.toISOString()], (err, rows) => {
    if (err) return;
    rows.forEach((row) => {
      fs.unlink(row.filepath, () => {});
      db.run(`DELETE FROM files WHERE id = ?`, row.id);
    });
  });
}, 24 * 60 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
