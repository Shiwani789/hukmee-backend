import { promises as fs } from "node:fs";
import type {
  ErrorRequestHandler,
  Request,
  RequestHandler,
  Response,
} from "express";
import { asyncHandler } from "../../utils/async-handler";
import { AppError } from "../../utils/errors";
import {
  validatedBody,
  validatedParams,
  validatedQuery,
} from "../../utils/validated-request";
import { brandBrowseSchema, brandSchemas } from "../../validation/brand";
import {
  categoryBrowseSchema,
  categorySchemas,
  categoryServicesSchema,
} from "../../validation/category";
import { modelBrowseSchema, modelSchemas } from "../../validation/model";
import { partSchemas } from "../../validation/part";
import {
  partGradeBrowseSchema,
  partGradeSchemas,
} from "../../validation/part-grade";
import {
  serviceBrowseSchema,
  servicePartsSchema,
  serviceSchemas,
} from "../../validation/service";
import {
  catalogService,
  withoutUndefined,
  type CatalogService,
} from "./catalog.service";

export class CatalogController {
  constructor(private readonly service: CatalogService = catalogService) {}

  prepareCatalogForm: RequestHandler = (req, _res, next) => {
    if (req.file) req.body.image = `/uploads/catalog/${req.file.filename}`;
    if (typeof req.body.active === "string") {
      if (req.body.active === "true" || req.body.active === "false")
        req.body.active = req.body.active === "true";
    }
    if (typeof req.body.sellingPrice === "string")
      req.body.sellingPrice = Number(req.body.sellingPrice);
    for (const field of ["compatibleModelIds", "compatibleServiceIds"]) {
      if (typeof req.body[field] === "string") {
        try {
          req.body[field] = JSON.parse(req.body[field]);
        } catch {
          return next(
            new AppError(
              400,
              "VALIDATION_ERROR",
              `${field} must be a JSON array of IDs`,
            ),
          );
        }
      }
    }
    next();
  };

  preparePartGradeForm: RequestHandler = (req, _res, next) => {
    if (req.file) req.body.image = `/uploads/catalog/${req.file.filename}`;
    if (typeof req.body.price === "string") {
      if (req.body.price === "null") req.body.price = null;
      else if (req.body.price !== "") req.body.price = Number(req.body.price);
      else delete req.body.price;
    }
    for (const field of ["active", "clearImage"]) {
      if (typeof req.body[field] === "string") {
        if (req.body[field] === "true" || req.body[field] === "false")
          req.body[field] = req.body[field] === "true";
      }
    }
    next();
  };

  cleanupFailedCatalogUpload: ErrorRequestHandler = (
    error,
    req,
    _res,
    next,
  ) => {
    if (!req.file) return next(error);
    void fs
      .unlink(req.file.path)
      .catch(() => undefined)
      .finally(() => next(error));
  };

  listCatalogGrades: RequestHandler = (req, res, next) => {
    const handler = req.baseUrl.endsWith("/admin/catalog")
      ? this.listPartGrades
      : this.browsePartGrades;
    return handler(req, res, next);
  };

  browseBrands = asyncHandler(async (_req: Request, res: Response) => {
    const data = await this.service.browseBrands(
      withoutUndefined(validatedQuery(brandBrowseSchema, res)),
    );
    res.json({ data });
  });
  listBrands = asyncHandler(async (_req: Request, res: Response) => {
    const data = await this.service.listBrands(
      withoutUndefined(validatedQuery(brandSchemas.list, res)),
    );
    res.json({ data });
  });
  getBrand = asyncHandler(async (_req: Request, res: Response) => {
    const data = await this.service.getBrand(
      validatedParams(brandSchemas.id, res).id,
    );
    res.json({ data });
  });
  createBrand = asyncHandler(async (_req: Request, res: Response) => {
    const data = await this.service.createBrand(
      withoutUndefined(validatedBody(brandSchemas.create, res)),
    );
    res.status(201).json({ data });
  });
  updateBrand = asyncHandler(async (_req: Request, res: Response) => {
    const data = await this.service.updateBrand(
      validatedParams(brandSchemas.update, res).id,
      withoutUndefined(validatedBody(brandSchemas.update, res)),
    );
    res.json({ data });
  });
  deactivateBrand = asyncHandler(async (_req: Request, res: Response) => {
    const data = await this.service.deactivateBrand(
      validatedParams(brandSchemas.id, res).id,
    );
    res.json({ data });
  });

  browseCategories = asyncHandler(async (_req: Request, res: Response) => {
    const data = await this.service.browseCategories(
      withoutUndefined(validatedQuery(categoryBrowseSchema, res)),
    );
    res.json({ data });
  });
  listCategories = asyncHandler(async (_req: Request, res: Response) => {
    const data = await this.service.listCategories(
      withoutUndefined(validatedQuery(categorySchemas.list, res)),
    );
    res.json({ data });
  });
  getCategory = asyncHandler(async (_req: Request, res: Response) => {
    const data = await this.service.getCategory(
      validatedParams(categorySchemas.id, res).id,
    );
    res.json({ data });
  });
  createCategory = asyncHandler(async (_req: Request, res: Response) => {
    const data = await this.service.createCategory(
      withoutUndefined(validatedBody(categorySchemas.create, res)),
    );
    res.status(201).json({ data });
  });
  updateCategory = asyncHandler(async (_req: Request, res: Response) => {
    const data = await this.service.updateCategory(
      validatedParams(categorySchemas.update, res).id,
      withoutUndefined(validatedBody(categorySchemas.update, res)),
    );
    res.json({ data });
  });
  deactivateCategory = asyncHandler(async (_req: Request, res: Response) => {
    const data = await this.service.deactivateCategory(
      validatedParams(categorySchemas.id, res).id,
    );
    res.json({ data });
  });
  listCategoryServices = asyncHandler(async (_req: Request, res: Response) => {
    const data = await this.service.listCategoryServices(
      validatedParams(categoryServicesSchema, res).categoryId,
      withoutUndefined(validatedQuery(categoryServicesSchema, res)).modelId,
    );
    res.json({ data });
  });

  browseModels = asyncHandler(async (_req: Request, res: Response) => {
    const data = await this.service.browseModels(
      withoutUndefined(validatedQuery(modelBrowseSchema, res)),
    );
    res.json({ data });
  });
  listModels = asyncHandler(async (_req: Request, res: Response) => {
    const data = await this.service.listModels(
      withoutUndefined(validatedQuery(modelSchemas.list, res)),
    );
    res.json({ data });
  });
  getModel = asyncHandler(async (_req: Request, res: Response) => {
    const data = await this.service.getModel(
      validatedParams(modelSchemas.id, res).id,
    );
    res.json({ data });
  });
  createModel = asyncHandler(async (_req: Request, res: Response) => {
    const data = await this.service.createModel(
      withoutUndefined(validatedBody(modelSchemas.create, res)),
    );
    res.status(201).json({ data });
  });
  updateModel = asyncHandler(async (_req: Request, res: Response) => {
    const data = await this.service.updateModel(
      validatedParams(modelSchemas.update, res).id,
      withoutUndefined(validatedBody(modelSchemas.update, res)),
    );
    res.json({ data });
  });
  deactivateModel = asyncHandler(async (_req: Request, res: Response) => {
    const data = await this.service.deactivateModel(
      validatedParams(modelSchemas.id, res).id,
    );
    res.json({ data });
  });

  listParts = asyncHandler(async (_req: Request, res: Response) => {
    const data = await this.service.listParts(
      withoutUndefined(validatedQuery(partSchemas.list, res)),
    );
    res.json({ data });
  });
  getPart = asyncHandler(async (_req: Request, res: Response) => {
    const data = await this.service.getPart(
      validatedParams(partSchemas.id, res).id,
    );
    res.json({ data });
  });
  createPart = asyncHandler(async (_req: Request, res: Response) => {
    const data = await this.service.createPart(
      withoutUndefined(validatedBody(partSchemas.create, res)),
    );
    res.status(201).json({ data });
  });
  updatePart = asyncHandler(async (_req: Request, res: Response) => {
    const data = await this.service.updatePart(
      validatedParams(partSchemas.update, res).id,
      withoutUndefined(validatedBody(partSchemas.update, res)),
    );
    res.json({ data });
  });
  deactivatePart = asyncHandler(async (_req: Request, res: Response) => {
    const data = await this.service.deactivatePart(
      validatedParams(partSchemas.id, res).id,
    );
    res.json({ data });
  });

  listPartGrades = asyncHandler(async (_req: Request, res: Response) => {
    const data = await this.service.listPartGrades(
      validatedParams(partGradeSchemas.list, res).partId,
    );
    res.json({ data });
  });
  browsePartGrades = asyncHandler(async (_req: Request, res: Response) => {
    const data = await this.service.browsePartGrades(
      validatedParams(partGradeBrowseSchema, res).partId,
      withoutUndefined(validatedQuery(partGradeBrowseSchema, res)),
    );
    res.json({ data });
  });
  createPartGrade = asyncHandler(async (_req: Request, res: Response) => {
    const data = await this.service.createPartGrade({
      ...withoutUndefined(validatedBody(partGradeSchemas.create, res)),
      partId: validatedParams(partGradeSchemas.create, res).partId,
    });
    res.status(201).json({ data });
  });
  updatePartGrade = asyncHandler(async (_req: Request, res: Response) => {
    const data = await this.service.updatePartGrade(
      validatedParams(partGradeSchemas.update, res).gradeId,
      withoutUndefined(validatedBody(partGradeSchemas.update, res)),
    );
    res.json({ data });
  });
  deactivatePartGrade = asyncHandler(async (_req: Request, res: Response) => {
    const data = await this.service.deactivatePartGrade(
      validatedParams(partGradeSchemas.id, res).gradeId,
    );
    res.json({ data });
  });

  browseServices = asyncHandler(async (_req: Request, res: Response) => {
    const data = await this.service.browseServices(
      withoutUndefined(validatedQuery(serviceBrowseSchema, res)),
    );
    res.json({ data });
  });
  listServices = asyncHandler(async (_req: Request, res: Response) => {
    const data = await this.service.listServices(
      withoutUndefined(validatedQuery(serviceSchemas.list, res)),
    );
    res.json({ data });
  });
  getService = asyncHandler(async (_req: Request, res: Response) => {
    const data = await this.service.getService(
      validatedParams(serviceSchemas.id, res).id,
    );
    res.json({ data });
  });
  createService = asyncHandler(async (_req: Request, res: Response) => {
    const data = await this.service.createService(
      withoutUndefined(validatedBody(serviceSchemas.create, res)),
    );
    res.status(201).json({ data });
  });
  updateService = asyncHandler(async (_req: Request, res: Response) => {
    const data = await this.service.updateService(
      validatedParams(serviceSchemas.update, res).id,
      withoutUndefined(validatedBody(serviceSchemas.update, res)),
    );
    res.json({ data });
  });
  deactivateService = asyncHandler(async (_req: Request, res: Response) => {
    const data = await this.service.deactivateService(
      validatedParams(serviceSchemas.id, res).id,
    );
    res.json({ data });
  });
  listServiceParts = asyncHandler(async (_req: Request, res: Response) => {
    const data = await this.service.listServiceParts(
      validatedParams(servicePartsSchema, res).serviceId,
      withoutUndefined(validatedQuery(servicePartsSchema, res)).modelId,
    );
    res.json({ data });
  });
}
