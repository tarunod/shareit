const fs = require('fs');
const path = require('path');

const LOG_FILE = 'C:\\ShareIt\\shareit.log';

function log(level, context, message) {
  try {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] [${level}] [${context}] ${message}\n`;
    
    // Ensure the folder exists before logging
    const dir = path.dirname(LOG_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.appendFileSync(LOG_FILE, logLine, 'utf8');
    console.log(logLine.trim());
  } catch (err) {
    console.error('Failed to write to log file', err);
  }
}

module.exports = {
  info: (context, msg) => log('INFO', context, msg),
  warn: (context, msg) => log('WARN', context, msg),
  error: (context, msg) => log('ERROR', context, msg),
  debug: (context, msg) => log('DEBUG', context, msg),
};
