import { Request, Response, NextFunction } from "express";
import { ZodSchema } from "zod";

export function validate(schema: ZodSchema, source: "body" | "query" | "params" = "body") {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return res.status(422).json({
        error: "Validation failed",
        details: result.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      });
    }
    (req as any).validated = { ...((req as any).validated || {}), [source]: result.data };
    next();
  };
}

export function getValidated<T>(req: Request, source: "body" | "query" | "params" = "body"): T {
  return ((req as any).validated || {})[source] as T;
}