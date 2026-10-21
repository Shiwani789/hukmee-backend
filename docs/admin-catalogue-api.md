# HUKMEE catalogue API

All routes are under `/api/v1/catalog`. Admin reads and writes require a bearer token for an `ADMIN` or `SUPER_ADMIN` account. `DELETE` deactivates a record instead of deleting it.

Grade APIs are also exposed under `/api/v1/admin/catalog` as requested; `/api/v1/catalog` remains the canonical catalogue route.

## Admin routes

| Resource          | Routes                                                                         |
| ----------------- | ------------------------------------------------------------------------------ |
| Brands            | `GET/POST /brands`, `GET/PATCH/DELETE /brands/{id}`                            |
| Device models     | `GET/POST /models`, `GET/PATCH/DELETE /models/{id}`                            |
| Repair categories | `GET/POST /service-categories`, `GET/PATCH/DELETE /service-categories/{id}`    |
| Repair services   | `GET /services/paginated`, `POST /services`, `GET/PATCH/DELETE /services/{id}` |
| Parts             | `GET/POST /parts`, `GET/PATCH/DELETE /parts/{id}`                              |
| Part grades       | `GET/POST /parts/{partId}/grades`, `PATCH/DELETE /part-grades/{gradeId}`       |

List routes accept `page`, `pageSize`, `search`, and `active=true|false`. Models can be filtered by `brandId`; services by `categoryId` and `modelId`; parts by `modelId`. Responses use `{ "data": ... }`, with `items` and `pagination` on paginated results. Errors use `{ "error": { "code", "message", "requestId" } }`.

Service create/update fields are `categoryId`, `name`, `description`, `active`, `image`, and `compatibleModelIds`. Part create/update fields include optional `sku` and `name`, plus `sellingPrice`, `image`, `active`, `compatibleModelIds`, and `compatibleServiceIds`. Blank/omitted part names and SKUs are stored as null. `sellingPrice` is the existing part price and is stored as `Decimal(12,2)`; there is no second part price. Service `basePrice` remains separate and is not treated as the part price or a final repair total.

Part grades are managed under `/catalog` and the explicit admin alias `/admin/catalog`. All grade routes require an authenticated `ADMIN` or `SUPER_ADMIN`. A grade is owned by a Part and has a unique name within that Part, nullable `price`, optional `image`, and `active`. `DELETE` deactivates the grade so booking references remain valid. Grade price is independent of both `Part.sellingPrice` and `RepairService.basePrice`; an unpriced grade is not returned to customers.

Grade images use multipart field `image`, JPEG/PNG/WebP, and the existing 5 MB limit. To clear an image without replacing it, send `clearImage=true` in a multipart request or `clearImage: true` in JSON. Do not combine it with an image upload. Old images are removed only after the database update succeeds and only if no catalogue record references the path.

Examples:

```http
POST /api/v1/admin/catalog/parts/{partId}/grades
Authorization: Bearer <admin-token>
Content-Type: multipart/form-data
```

Fields: `name`, optional `price`, optional `active`, optional file `image`.

Successful creation returns `{ "data": { "id": "...", "partId": "...", "name": "...", "price": "...", "image": "/uploads/catalog/...", "active": true, "createdAt": "...", "updatedAt": "..." } }`. If price is omitted or null, admin can see the grade but customers will not receive it as a selectable grade.

```http
PATCH /api/v1/admin/catalog/part-grades/{gradeId}
Authorization: Bearer <admin-token>
Content-Type: application/json
```

```json
{ "price": 849.5, "active": true }
```

When uploading an image, send `multipart/form-data` with the file field named `image`. Compatibility ID arrays may be JSON strings in multipart requests. Without a file, JSON requests remain supported. Parts require `sellingPrice` on create.

### Admin Part workflow

1. Create or edit a Repair Service and choose its compatible device models.
2. Create or edit a Part, enter its SKU/name/`sellingPrice`, and choose its compatible device models.
3. In **Applicable repair services**, select one or more active services that overlap at least one selected device model.
4. Save. The API stores the association in `RepairServicePart`; it does not copy part details or price onto the service.

A service can be mapped to multiple parts, and a part can be reused by multiple services. Invalid IDs return 404. Inactive services/models, or service/part model sets with no overlap, return 409 `CATALOG_MAPPING_INVALID`. A mapping update replaces the selected service mappings; omitting `compatibleServiceIds` preserves them. Changing a part's model compatibility while retaining mappings is rejected if it would make them incompatible.

Example Part request:

```json
{
  "sku": "DISP-001",
  "name": "Display assembly",
  "sellingPrice": 349.0,
  "compatibleModelIds": ["00000000-0000-4000-8000-000000000001"],
  "compatibleServiceIds": ["00000000-0000-4000-8000-000000000002"]
}
```

## Customer catalogue flow

- `GET /brands` returns active brands.
- `GET /models?brandId={brandId}` returns active models for an active brand.
- `GET /categories?modelId={modelId}` returns active categories containing at least one active service compatible with the active model and brand. Without `modelId`, it returns all active categories. The response contains only category fields.
- `GET /categories/{categoryId}/services` returns that active category with its active compatible services, parts, and priced active grades. This category-only form includes services/parts compatible with any active model and brand; pass `?modelId={modelId}` to restrict them to one active model and brand.
- `GET /services?modelId={modelId}&categoryId={categoryId}` returns services in that category compatible with the active model, with their active compatible parts and active priced grades. Grade eligibility does not depend on `Part.sellingPrice`; it is returned unchanged and never used as a grade price. Grade images use the public catalog image URL convention.
- `GET /services/{serviceId}/parts?modelId={modelId}` returns active parts mapped to that active service and compatible with the active model and brand, along with their active priced grades.
- `GET /parts/{partId}/grades` returns active, priced grades for an active part. Optionally provide both `modelId` and `serviceId` to validate the part, service, and model compatibility mappings. If one filter is supplied, the other is required too.
- For backward compatibility, `GET /services?modelId={modelId}` without `categoryId` retains the grouped category → services response. `serviceId` can also be supplied to filter by service.

Example:

```http
GET /api/v1/catalog/categories?modelId=00000000-0000-4000-8000-000000000001
```

Category response:

```json
{
  "data": [
    {
      "id": "category-id",
      "name": "Screen"
    }
  ]
}
```

Then fetch services for the selected category:

```http
GET /api/v1/catalog/services?modelId=00000000-0000-4000-8000-000000000001&categoryId=category-id
```

If the client only has a category ID, it can instead fetch the category and selectable service data in one request:

```http
GET /api/v1/catalog/categories/category-id/services
```

Service response (Prisma Decimal values serialize as strings):

```json
{
  "data": [
    {
      "id": "00000000-0000-4000-8000-000000000002",
      "name": "Screen repair",
      "description": "Replace a damaged screen",
      "basePrice": null,
      "image": null,
      "parts": [
        {
          "id": "00000000-0000-4000-8000-000000000004",
          "name": "Display assembly",
          "sku": "DISP-001",
          "sellingPrice": "349",
          "image": null,
          "grades": [
            {
              "id": "grade-id",
              "name": "Configured grade",
              "price": "849.50",
              "image": null
            }
          ]
        }
      ]
    }
  ]
}
```

The model-only service request retains its existing grouped response, where each category has a `services` array.

If no part is mapped or no active compatible part exists, `parts` is an empty array. A part's `grades` list excludes inactive or unpriced grades. No price is fabricated. `basePrice`, part `sellingPrice`, and grade `price` remain separate values. The current schema has `active` status but no service/part approval field; the public catalogue therefore uses its existing active flags and model/brand/category status relationships. Approval-specific filtering requires an SOW-defined status field and policy, which are not present in this repository. Inventory quantities are not treated as customer availability until hub-selection rules are defined.

Bookings may include `partGradeId`. When present, the server validates that the grade is active and priced, its part is active and compatible with the owned device model, and the part is mapped to the selected active service. Client prices are ignored. The booking stores `partGradeId`, `partNameSnapshot`, `gradeNameSnapshot`, and `gradePriceSnapshot`. This is the configured catalogue price at request time; inspection estimates, approval, and payments retain their existing behavior. The selected price is not declared the final repair amount by this API.

Example booking request:

```json
{
  "deviceId": "owned-device-uuid",
  "serviceId": "repair-service-uuid",
  "partGradeId": "active-priced-grade-uuid",
  "problemDescription": "The display is damaged"
}
```

## Migration and data

`20261019230000_add_repair_service_parts` creates an empty join table and adds foreign keys/indexes. It does not alter existing catalogue rows or prices; current records remain unmapped until an admin configures them. Apply it to the local database with the project's normal development migration command after PostgreSQL is available.

`20261020130000_add_part_grades_and_booking_snapshots` creates the `PartGrade` table and adds nullable grade-reference and price/name snapshot columns to `Booking`. Existing bookings remain valid with null grade snapshot fields; no existing part or service prices are modified. This migration has not been applied to a database in this environment.
