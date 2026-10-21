# Vendor identity document KYC

Vendor identity documents use private encrypted local storage under `storage/private/vendor-kyc`; that folder is not mounted as static content. Files are AES-256-GCM encrypted at rest. `KYC_DOCUMENT_ENCRYPTION_KEY` must be a secret 32-byte key encoded as 64 hexadecimal characters. Document numbers are encrypted with the same key and only their masked value is returned. Keep the key in deployment secret storage and preserve it for decrypting existing documents.

No ID type or image side is mandatory by default. Aadhaar and PAN are enabled, with document number, document name, front image, and back image optional. Configure approved types and requirements through `VENDOR_KYC_DOCUMENT_POLICY`, a JSON object keyed by uppercase document type. For example:

```json
{
  "documents": {
    "AADHAAR": {
      "enabled": true,
      "required": false,
      "numberRequired": false,
      "nameRequired": false,
      "frontRequired": false,
      "backRequired": false
    },
    "PAN": {
      "enabled": true,
      "required": false,
      "numberRequired": false,
      "nameRequired": false,
      "frontRequired": true,
      "backRequired": false
    },
    "BUSINESS_LICENSE": {
      "enabled": true,
      "required": true,
      "numberRequired": true,
      "nameRequired": true,
      "frontRequired": true,
      "backRequired": false,
      "numberPattern": "^[A-Z0-9-]{6,30}$"
    }
  }
}
```

Aadhaar numbers are validated as 12 digits and PAN numbers as the standard 10-character format. Other configured document types may provide a `numberPattern`. If a document number is supplied without the encryption key, the API fails closed and does not store it. Uploaded files accept JPEG, PNG, WebP, or PDF up to 8 MB per file. The front/back endpoints require the owning VENDOR/TECHNICIAN or an ADMIN/SUPER_ADMIN session and return `private, no-store`; admin reads and all review decisions are audited.

## Endpoints

- `GET /api/v1/vendor/kyc/policy` — configured document and bank requirements.
- `GET /api/v1/vendor/kyc/status` — application status, completed steps, missing requirements, masked document metadata, and review timestamps/feedback.
- `GET/PUT /api/v1/vendor/kyc/personal-details` — save the person's name to `User.displayName`; email, phone, verification state, and profile image are read from the `User` record and are not duplicated in the KYC request.
- `GET/PUT /api/v1/vendor/kyc/address` — retrieve or save service address.
- `GET/PUT /api/v1/vendor/kyc/identity` — retrieve document metadata or upload one document version with optional `documentNumber`, `nameOnDocument`, `frontImage`, and `backImage` as multipart/form-data. Repeat the PUT for multiple document types.
- `GET/PUT /api/v1/vendor/kyc/professional-details` — save experience and optional description in KYC; selected repair services use existing `TechnicianSkill` and `RepairService` records. No free-text skills or duplicate service labels are stored.
- `GET/PUT /api/v1/vendor/kyc/bank-details` — retrieve masked bank data or save bank details encrypted at rest; optional unless `VENDOR_KYC_BANK_DETAILS_REQUIRED=true`.
- `POST /api/v1/vendor/kyc/submit` — submit after personal, address, and professional steps plus all configured identity requirements are complete.
- `GET /api/v1/vendor/kyc/documents/:documentId/:side` — vendor's own private file (`front` or `back`).
- `GET /api/v1/admin/vendor-kyc` — pending applications with minimal identifiers.
- Davai-style admin aliases: `GET /api/v1/admin/vendor-kyc/requests`, `GET /api/v1/admin/vendor-kyc/requests/:applicationId`, `POST /api/v1/admin/vendor-kyc/requests/:applicationId/approve`, and `POST /api/v1/admin/vendor-kyc/requests/:applicationId/reject` (JSON `{ "reason": "..." }` required for rejection).
- `GET /api/v1/admin/vendor-kyc/:applicationId` — authorized review detail with masked numbers and private file endpoints.
- `PATCH /api/v1/admin/vendor-kyc/documents/:documentId/review` — set `APPROVED`, `REJECTED`, or `RESUBMISSION_REQUIRED`; feedback is required for the latter two.
- `PATCH /api/v1/admin/vendor-kyc/:applicationId/review` — set overall status; approval requires every latest uploaded document and each policy-required document to be approved.
- `GET /api/v1/admin/vendor-kyc/documents/:documentId/:side` — audited, authorized private file access for reviewers.

Each re-upload creates a new document-version record and retains the prior document metadata; omitted optional numbers, names, or image sides preserve the latest value. Approved or pending applications cannot be edited. A rejected application stays rejected while the vendor edits; `POST /submit` is also the resubmission operation and transitions it back to pending review. Admin rejection feedback remains visible until the next admin review. Retention/deletion is intentionally not automatic because the approved retention period has not been supplied.

Legacy aliases (`GET /`, `/basic-information`, `/address`, `/business-details`, `/bank-info`, `/documents`, and `POST /step-*` or `/documents`) were not found in the repository's frontend or Postman collection before this cleanup and have been removed. Clients should use the canonical endpoints above.
