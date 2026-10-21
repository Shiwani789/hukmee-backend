import { Router, type RequestHandler } from "express";
import { authenticate } from "../../middlewares/auth";
import { requireRole } from "../../middlewares/role";
import { catalogImageUpload } from "../../middlewares/upload";
import { cacheResponse, invalidateCache } from "../../middlewares/redis-cache";
import { validate } from "../../utils/validate";
import { CatalogController } from "./catalog.controller";
import { brandSchemas, brandBrowseSchema } from "../../validation/brand";
import {
  categorySchemas,
  categoryBrowseSchema,
  categoryServicesSchema,
} from "../../validation/category";
import { modelSchemas, modelBrowseSchema } from "../../validation/model";
import { partSchemas } from "../../validation/part";
import {
  partGradeBrowseSchema,
  partGradeSchemas,
} from "../../validation/part-grade";
import {
  serviceSchemas,
  servicePartsSchema,
  serviceBrowseSchema,
} from "../../validation/service";

const catalogGradeAccess: RequestHandler = (req, res, next) => {
  if (!req.baseUrl.endsWith("/admin/catalog")) return next();
  authenticate(req, res, (error) => {
    if (error) return next(error);
    return requireRole("ADMIN", "SUPER_ADMIN")(req, res, next);
  });
};

const validateCatalogGradeList: RequestHandler = (req, res, next) =>
  validate(
    req.baseUrl.endsWith("/admin/catalog")
      ? partGradeSchemas.list
      : partGradeBrowseSchema,
  )(req, res, next);

const cachePublicCatalogGrades: RequestHandler = (req, res, next) => {
  if (req.baseUrl.endsWith("/admin/catalog")) return next();
  return cacheResponse({ namespace: "catalog:services", ttlSeconds: 600 })(
    req,
    res,
    next,
  );
};

const router = Router();
const catalogController = new CatalogController();

// Public catalogue browsing routes.
router.get(
  "/brands",
  cacheResponse({ namespace: "catalog:brands", ttlSeconds: 600 }),
  validate(brandBrowseSchema),
  catalogController.browseBrands,
);
router.get(
  "/models",
  cacheResponse({ namespace: "catalog:models", ttlSeconds: 600 }),
  validate(modelBrowseSchema),
  catalogController.browseModels,
);
router.get(
  "/categories",
  cacheResponse({ namespace: "catalog:categories", ttlSeconds: 600 }),
  validate(categoryBrowseSchema),
  catalogController.browseCategories,
);
router.get(
  "/categories/:categoryId/services",
  cacheResponse({ namespace: "catalog:services", ttlSeconds: 600 }),
  validate(categoryServicesSchema),
  catalogController.listCategoryServices,
);
router.get(
  "/services",
  cacheResponse({ namespace: "catalog:services", ttlSeconds: 600 }),
  validate(serviceBrowseSchema),
  catalogController.browseServices,
);
router.get(
  "/services/:serviceId/parts",
  cacheResponse({ namespace: "catalog:services", ttlSeconds: 600 }),
  validate(servicePartsSchema),
  catalogController.listServiceParts,
);
router.get(
  "/parts/:partId/grades",
  catalogGradeAccess,
  cachePublicCatalogGrades,
  validateCatalogGradeList,
  catalogController.listCatalogGrades,
);

const adminAccess = [
  authenticate,
  requireRole("ADMIN", "SUPER_ADMIN"),
] as const;

// Admin catalog management routes.
// Admin brands.
router.get(
  "/brands/paginated",
  ...adminAccess,
  validate(brandSchemas.list),
  catalogController.listBrands,
);
router.get(
  "/brands/:id",
  ...adminAccess,
  validate(brandSchemas.id),
  catalogController.getBrand,
);
router.post(
  "/brands",
  ...adminAccess,
  invalidateCache(
    "catalog:brands",
    "catalog:models",
    "catalog:services",
    "catalog:categories",
  ),
  catalogImageUpload(),
  catalogController.prepareCatalogForm,
  validate(brandSchemas.create),
  catalogController.createBrand,
  catalogController.cleanupFailedCatalogUpload,
);
router.patch(
  "/brands/:id",
  ...adminAccess,
  invalidateCache(
    "catalog:brands",
    "catalog:models",
    "catalog:services",
    "catalog:categories",
  ),
  catalogImageUpload(),
  catalogController.prepareCatalogForm,
  validate(brandSchemas.update),
  catalogController.updateBrand,
  catalogController.cleanupFailedCatalogUpload,
);
router.delete(
  "/brands/:id",
  ...adminAccess,
  invalidateCache(
    "catalog:brands",
    "catalog:models",
    "catalog:services",
    "catalog:categories",
  ),
  validate(brandSchemas.id),
  catalogController.deactivateBrand,
);
// Admin devices and models.
router.get(
  "/models/paginated",
  ...adminAccess,
  validate(modelSchemas.list),
  catalogController.listModels,
);
router.get(
  "/models/:id",
  ...adminAccess,
  validate(modelSchemas.id),
  catalogController.getModel,
);
router.post(
  "/models",
  ...adminAccess,
  invalidateCache(
    "catalog:brands",
    "catalog:models",
    "catalog:services",
    "catalog:categories",
  ),
  catalogImageUpload(),
  catalogController.prepareCatalogForm,
  validate(modelSchemas.create),
  catalogController.createModel,
  catalogController.cleanupFailedCatalogUpload,
);
router.patch(
  "/models/:id",
  ...adminAccess,
  invalidateCache(
    "catalog:brands",
    "catalog:models",
    "catalog:services",
    "catalog:categories",
  ),
  catalogImageUpload(),
  catalogController.prepareCatalogForm,
  validate(modelSchemas.update),
  catalogController.updateModel,
  catalogController.cleanupFailedCatalogUpload,
);
router.delete(
  "/models/:id",
  ...adminAccess,
  invalidateCache(
    "catalog:brands",
    "catalog:models",
    "catalog:services",
    "catalog:categories",
  ),
  validate(modelSchemas.id),
  catalogController.deactivateModel,
);
// Admin service categories.
router.get(
  "/service-categories",
  ...adminAccess,
  validate(categorySchemas.list),
  catalogController.listCategories,
);
router.get(
  "/service-categories/:id",
  ...adminAccess,
  validate(categorySchemas.id),
  catalogController.getCategory,
);
router.post(
  "/service-categories",
  ...adminAccess,
  invalidateCache(
    "catalog:brands",
    "catalog:models",
    "catalog:services",
    "catalog:categories",
  ),
  validate(categorySchemas.create),
  catalogController.createCategory,
);
router.patch(
  "/service-categories/:id",
  ...adminAccess,
  invalidateCache(
    "catalog:brands",
    "catalog:models",
    "catalog:services",
    "catalog:categories",
  ),
  validate(categorySchemas.update),
  catalogController.updateCategory,
);
router.delete(
  "/service-categories/:id",
  ...adminAccess,
  invalidateCache(
    "catalog:brands",
    "catalog:models",
    "catalog:services",
    "catalog:categories",
  ),
  validate(categorySchemas.id),
  catalogController.deactivateCategory,
);
// Admin repair services.
router.get(
  "/services/paginated",
  ...adminAccess,
  validate(serviceSchemas.list),
  catalogController.listServices,
);
router.get(
  "/services/:id",
  ...adminAccess,
  validate(serviceSchemas.id),
  catalogController.getService,
);
router.post(
  "/services",
  ...adminAccess,
  invalidateCache(
    "catalog:brands",
    "catalog:models",
    "catalog:services",
    "catalog:categories",
  ),
  catalogImageUpload(),
  catalogController.prepareCatalogForm,
  validate(serviceSchemas.create),
  catalogController.createService,
  catalogController.cleanupFailedCatalogUpload,
);
router.patch(
  "/services/:id",
  ...adminAccess,
  invalidateCache(
    "catalog:brands",
    "catalog:models",
    "catalog:services",
    "catalog:categories",
  ),
  catalogImageUpload(),
  catalogController.prepareCatalogForm,
  validate(serviceSchemas.update),
  catalogController.updateService,
  catalogController.cleanupFailedCatalogUpload,
);
router.delete(
  "/services/:id",
  ...adminAccess,
  invalidateCache(
    "catalog:brands",
    "catalog:models",
    "catalog:services",
    "catalog:categories",
  ),
  validate(serviceSchemas.id),
  catalogController.deactivateService,
);
// Admin parts.
router.get(
  "/parts",
  ...adminAccess,
  validate(partSchemas.list),
  catalogController.listParts,
);
router.get(
  "/parts/:id",
  ...adminAccess,
  validate(partSchemas.id),
  catalogController.getPart,
);
router.post(
  "/parts",
  ...adminAccess,
  invalidateCache("catalog:brands", "catalog:models", "catalog:services"),
  catalogImageUpload(),
  catalogController.prepareCatalogForm,
  validate(partSchemas.create),
  catalogController.createPart,
  catalogController.cleanupFailedCatalogUpload,
);
router.patch(
  "/parts/:id",
  ...adminAccess,
  invalidateCache("catalog:brands", "catalog:models", "catalog:services"),
  catalogImageUpload(),
  catalogController.prepareCatalogForm,
  validate(partSchemas.update),
  catalogController.updatePart,
  catalogController.cleanupFailedCatalogUpload,
);
router.delete(
  "/parts/:id",
  ...adminAccess,
  invalidateCache(
    "catalog:brands",
    "catalog:models",
    "catalog:services",
    "catalog:categories",
  ),
  validate(partSchemas.id),
  catalogController.deactivatePart,
);

// Admin part grades.
router.post(
  "/parts/:partId/grades",
  ...adminAccess,
  invalidateCache("catalog:services"),
  catalogImageUpload(),
  catalogController.preparePartGradeForm,
  validate(partGradeSchemas.create),
  catalogController.createPartGrade,
  catalogController.cleanupFailedCatalogUpload,
);
router.patch(
  "/part-grades/:gradeId",
  ...adminAccess,
  invalidateCache("catalog:services"),
  catalogImageUpload(),
  catalogController.preparePartGradeForm,
  validate(partGradeSchemas.update),
  catalogController.updatePartGrade,
  catalogController.cleanupFailedCatalogUpload,
);
router.delete(
  "/part-grades/:gradeId",
  ...adminAccess,
  invalidateCache("catalog:services"),
  validate(partGradeSchemas.id),
  catalogController.deactivatePartGrade,
);

export default router;
