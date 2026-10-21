import { vendorKycRoutes } from "../src/modules/vendor-kyc/vendor-kyc.routes";

describe("canonical vendor KYC routes", () => {
  const routes = vendorKycRoutes.stack
    .filter((layer) => layer.route)
    .map((layer) => ({
      path: (layer.route as unknown as { path: string }).path,
      methods: Object.keys(
        (layer.route as unknown as { methods: Record<string, boolean> })
          .methods,
      ),
    }));

  it("uses GET and PUT for all five steps", () => {
    for (const path of [
      "/personal-details",
      "/address",
      "/identity",
      "/professional-details",
      "/bank-details",
    ]) {
      expect(routes).toContainEqual({ path, methods: ["get"] });
      expect(routes).toContainEqual({ path, methods: ["put"] });
    }
  });

  it("keeps one status, submit, and private document access contract", () => {
    expect(routes).toContainEqual({ path: "/status", methods: ["get"] });
    expect(routes).toContainEqual({ path: "/submit", methods: ["post"] });
    expect(routes).toContainEqual({
      path: "/documents/:documentId/:side",
      methods: ["get"],
    });
    expect(
      routes.some(({ path }) => path === "/" || path === "/documents"),
    ).toBe(false);
  });
});
