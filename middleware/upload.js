// ============================================
// middleware/upload.js
// File Upload Configuration with Multer
// ============================================

const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { AppError } = require('./errorHandler');
const logger = require('../utils/logger');

// Ensure upload directories exist
const ensureDirectoryExists = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

// Base upload directory
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '../uploads');
ensureDirectoryExists(UPLOAD_DIR);

// KYC documents directory
const KYC_DIR = path.join(UPLOAD_DIR, 'kyc');
ensureDirectoryExists(KYC_DIR);

// Profile pictures directory
const PROFILE_DIR = path.join(UPLOAD_DIR, 'profiles');
ensureDirectoryExists(PROFILE_DIR);

// ============================================
// FILE FILTERS
// ============================================

/**
 * Filter for KYC documents (PDF, JPG, PNG)
 */
const kycDocumentFilter = (req, file, cb) => {
  const allowedMimes = [
    'application/pdf',
    'image/jpeg',
    'image/jpg',
    'image/png'
  ];

  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new AppError('Invalid file type. Only PDF, JPG, and PNG files are allowed.', 400), false);
  }
};

/**
 * Filter for profile pictures (JPG, PNG)
 */
const imageFilter = (req, file, cb) => {
  const allowedMimes = [
    'image/jpeg',
    'image/jpg',
    'image/png'
  ];

  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new AppError('Invalid file type. Only JPG and PNG images are allowed.', 400), false);
  }
};

// ============================================
// STORAGE CONFIGURATIONS
// ============================================

/**
 * Storage configuration for KYC documents
 */
const kycStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Create user-specific directory
    const userDir = path.join(KYC_DIR, req.user.id.toString());
    ensureDirectoryExists(userDir);
    cb(null, userDir);
  },
  filename: (req, file, cb) => {
    // Generate unique filename: documentType_timestamp_randomHash.ext
    const documentType = req.body.documentType || 'document';
    const timestamp = Date.now();
    const randomHash = crypto.randomBytes(8).toString('hex');
    const ext = path.extname(file.originalname);
    const filename = `${documentType}_${timestamp}_${randomHash}${ext}`;
    cb(null, filename);
  }
});

/**
 * Storage configuration for profile pictures
 */
const profileStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, PROFILE_DIR);
  },
  filename: (req, file, cb) => {
    const userId = req.user.id;
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    const filename = `profile_${userId}_${timestamp}${ext}`;
    cb(null, filename);
  }
});

/**
 * Memory storage for temporary processing
 */
const memoryStorage = multer.memoryStorage();

// ============================================
// MULTER CONFIGURATIONS
// ============================================

/**
 * Upload configuration for KYC documents
 * Max file size: 10MB
 * Max files: 5 per request
 */
const uploadKycDocuments = multer({
  storage: kycStorage,
  fileFilter: kycDocumentFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 5
  }
});

/**
 * Upload configuration for profile picture
 * Max file size: 5MB
 * Single file only
 */
const uploadProfilePicture = multer({
  storage: profileStorage,
  fileFilter: imageFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 1
  }
});

/**
 * Upload to memory (for processing before saving)
 */
const uploadToMemory = multer({
  storage: memoryStorage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  }
});

// ============================================
// MIDDLEWARE FUNCTIONS
// ============================================

/**
 * Middleware to handle KYC document uploads
 */
const handleKycUpload = (fieldName = 'documents') => {
  return (req, res, next) => {
    const upload = uploadKycDocuments.array(fieldName, 5);
    
    upload(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        logger.error('Multer error:', err);
        
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(new AppError('File size exceeds 10MB limit', 400));
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
          return next(new AppError('Maximum 5 files allowed per upload', 400));
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
          return next(new AppError('Unexpected file field', 400));
        }
        
        return next(new AppError(err.message, 400));
      } else if (err) {
        return next(err);
      }
      
      // Validate uploaded files
      if (!req.files || req.files.length === 0) {
        return next(new AppError('No files uploaded', 400));
      }
      
      logger.info(`User ${req.user.id} uploaded ${req.files.length} KYC documents`);
      next();
    });
  };
};

/**
 * Middleware to handle profile picture upload
 */
const handleProfilePictureUpload = (req, res, next) => {
  const upload = uploadProfilePicture.single('profilePicture');
  
  upload(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      logger.error('Multer error:', err);
      
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new AppError('File size exceeds 5MB limit', 400));
      }
      
      return next(new AppError(err.message, 400));
    } else if (err) {
      return next(err);
    }
    
    if (!req.file) {
      return next(new AppError('No file uploaded', 400));
    }
    
    logger.info(`User ${req.user.id} uploaded profile picture`);
    next();
  });
};

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Delete a file
 */
const deleteFile = (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      logger.debug(`File deleted: ${filePath}`);
      return true;
    }
    return false;
  } catch (error) {
    logger.error(`Error deleting file ${filePath}:`, error);
    return false;
  }
};

/**
 * Delete multiple files
 */
const deleteFiles = (filePaths) => {
  return filePaths.map(deleteFile);
};

/**
 * Get file size in human-readable format
 */
const getFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
};

/**
 * Validate file exists and is accessible
 */
const validateFileAccess = (filePath, userId) => {
  try {
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      throw new AppError('File not found', 404);
    }
    
    // Check if file belongs to user (path includes user ID)
    if (!filePath.includes(userId.toString())) {
      throw new AppError('Unauthorized access to file', 403);
    }
    
    return true;
  } catch (error) {
    throw error;
  }
};

/**
 * Get file metadata
 */
const getFileMetadata = (filePath) => {
  try {
    const stats = fs.statSync(filePath);
    return {
      size: stats.size,
      sizeFormatted: getFileSize(stats.size),
      created: stats.birthtime,
      modified: stats.mtime,
      extension: path.extname(filePath),
      filename: path.basename(filePath)
    };
  } catch (error) {
    logger.error(`Error getting file metadata:`, error);
    throw new AppError('Error retrieving file information', 500);
  }
};

/**
 * Clean up old user files (older than specified days)
 */
const cleanupOldFiles = async (userId, days = 90) => {
  try {
    const userKycDir = path.join(KYC_DIR, userId.toString());
    
    if (!fs.existsSync(userKycDir)) {
      return 0;
    }
    
    const files = fs.readdirSync(userKycDir);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    
    let deletedCount = 0;
    
    files.forEach(file => {
      const filePath = path.join(userKycDir, file);
      const stats = fs.statSync(filePath);
      
      if (stats.mtime < cutoffDate) {
        if (deleteFile(filePath)) {
          deletedCount++;
        }
      }
    });
    
    logger.info(`Cleaned up ${deletedCount} old files for user ${userId}`);
    return deletedCount;
    
  } catch (error) {
    logger.error(`Error cleaning up files for user ${userId}:`, error);
    return 0;
  }
};

/**
 * Get total storage used by user
 */
const getUserStorageUsage = (userId) => {
  try {
    const userKycDir = path.join(KYC_DIR, userId.toString());
    
    if (!fs.existsSync(userKycDir)) {
      return { totalBytes: 0, totalFormatted: '0 Bytes', fileCount: 0 };
    }
    
    const files = fs.readdirSync(userKycDir);
    let totalBytes = 0;
    
    files.forEach(file => {
      const filePath = path.join(userKycDir, file);
      const stats = fs.statSync(filePath);
      totalBytes += stats.size;
    });
    
    return {
      totalBytes,
      totalFormatted: getFileSize(totalBytes),
      fileCount: files.length
    };
    
  } catch (error) {
    logger.error(`Error calculating storage for user ${userId}:`, error);
    return { totalBytes: 0, totalFormatted: '0 Bytes', fileCount: 0 };
  }
};

module.exports = {
  uploadKycDocuments,
  uploadProfilePicture,
  uploadToMemory,
  handleKycUpload,
  handleProfilePictureUpload,
  deleteFile,
  deleteFiles,
  getFileSize,
  validateFileAccess,
  getFileMetadata,
  cleanupOldFiles,
  getUserStorageUsage,
  KYC_DIR,
  PROFILE_DIR,
  UPLOAD_DIR
};