// ============================================
// controllers/kyc.controller.js
// KYC Verification Controller
// ============================================

const { query, transaction } = require('../config/database');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const path = require('path');

/**
 * @route   POST /api/v1/kyc/upload
 * @desc    Upload KYC documents
 * @access  Private
 */
const uploadDocuments = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { documentType } = req.body;
  const files = req.files;

  if (!files || files.length === 0) {
    throw new AppError('No files uploaded', 400);
  }

  // Valid document types
  const validTypes = ['passport', 'drivers_license', 'national_id', 'proof_of_address', 'selfie'];
  if (!validTypes.includes(documentType)) {
    throw new AppError('Invalid document type', 400);
  }

  // Insert document records
  const documents = [];
  for (const file of files) {
    const result = await query(`
      INSERT INTO kyc_documents (
        user_id, document_type, file_path, file_name, file_size, mime_type
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [
      userId,
      documentType,
      file.path,
      file.filename,
      file.size,
      file.mimetype
    ]);

    documents.push(result.rows[0]);
  }

  // Update KYC status to pending if not already
  await query(`
    UPDATE user_kyc
    SET 
      status = CASE 
        WHEN status = 'not_started' THEN 'pending'
        ELSE status
      END,
      updated_at = CURRENT_TIMESTAMP
    WHERE user_id = $1
  `, [userId]);

  logger.info(`KYC documents uploaded by user: ${userId}, Type: ${documentType}, Count: ${files.length}`);

  res.status(201).json({
    success: true,
    message: 'Documents uploaded successfully',
    data: {
      documents: documents.map(doc => ({
        id: doc.id,
        type: doc.document_type,
        fileName: doc.file_name,
        uploadedAt: doc.uploaded_at,
        status: doc.status
      }))
    }
  });
});

/**
 * @route   GET /api/v1/kyc/status
 * @desc    Get KYC status
 * @access  Private
 */
const getKycStatus = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const kycResult = await query(`
    SELECT 
      k.*,
      (SELECT COUNT(*) FROM kyc_documents WHERE user_id = k.user_id) as documents_count,
      (SELECT COUNT(*) FROM kyc_documents WHERE user_id = k.user_id AND status = 'approved') as approved_docs,
      (SELECT COUNT(*) FROM kyc_documents WHERE user_id = k.user_id AND status = 'rejected') as rejected_docs
    FROM user_kyc k
    WHERE k.user_id = $1
  `, [userId]);

  if (kycResult.rows.length === 0) {
    throw new AppError('KYC record not found', 404);
  }

  const kyc = kycResult.rows[0];

  // Get documents
  const docsResult = await query(`
    SELECT 
      id, document_type, file_name, status, uploaded_at, reviewed_at
    FROM kyc_documents
    WHERE user_id = $1
    ORDER BY uploaded_at DESC
  `, [userId]);

  res.json({
    success: true,
    data: {
      kyc: {
        status: kyc.status,
        verificationLevel: kyc.verification_level,
        submittedAt: kyc.submitted_at,
        reviewedAt: kyc.reviewed_at,
        rejectionReason: kyc.rejection_reason,
        documentsCount: parseInt(kyc.documents_count),
        approvedDocs: parseInt(kyc.approved_docs),
        rejectedDocs: parseInt(kyc.rejected_docs)
      },
      documents: docsResult.rows
    }
  });
});

/**
 * @route   POST /api/v1/kyc/submit
 * @desc    Submit KYC for review
 * @access  Private
 */
const submitForReview = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { documentType, documentNumber, documentExpiry } = req.body;

  // Check if documents are uploaded
  const docsCount = await query(
    'SELECT COUNT(*) as count FROM kyc_documents WHERE user_id = $1',
    [userId]
  );

  if (parseInt(docsCount.rows[0].count) < 2) {
    throw new AppError('Please upload at least 2 documents (ID and proof of address)', 400);
  }

  // Update KYC record
  const result = await query(`
    UPDATE user_kyc
    SET 
      status = 'under_review',
      document_type = $1,
      document_number = $2,
      document_expiry = $3,
      submitted_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
    WHERE user_id = $4
    RETURNING *
  `, [documentType, documentNumber, documentExpiry, userId]);

  logger.info(`KYC submitted for review by user: ${userId}`);

  // TODO: Trigger notification to admin/compliance team

  res.json({
    success: true,
    message: 'KYC submitted for review. You will be notified once verified.',
    data: {
      kyc: result.rows[0]
    }
  });
});

/**
 * @route   GET /api/v1/kyc/documents/:id
 * @desc    Get specific document
 * @access  Private
 */
const getDocument = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  const result = await query(
    'SELECT * FROM kyc_documents WHERE id = $1 AND user_id = $2',
    [id, userId]
  );

  if (result.rows.length === 0) {
    throw new AppError('Document not found', 404);
  }

  const document = result.rows[0];

  // Send file
  res.sendFile(path.resolve(document.file_path));
});

module.exports = {
  uploadDocuments,
  getKycStatus,
  submitForReview,
  getDocument
};


