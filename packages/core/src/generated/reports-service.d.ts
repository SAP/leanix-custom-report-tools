export interface paths {
  '/healthcheck': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Service health check */
    get: operations['HealthcheckController_getStatus'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/customReportVersions/upload': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Upload a custom report source archive */
    post: operations['CustomReportVersionsController_upload'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/customReportVersions/{customReportVersionId}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Get custom report version metadata */
    get: operations['CustomReportVersionsController_getMetadata'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/customReportVersions/{customReportVersionId}/src': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Download source archive (uploader only) */
    get: operations['CustomReportVersionsController_getSource'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/customReportVersions/{customReportVersionId}/dist': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Download dist archive (uploader only) */
    get: operations['CustomReportVersionsController_getDist'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/customReportVersions/{id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    /** Delete a custom report version */
    delete: operations['CustomReportVersionsController_deleteVersion'];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/customReports': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** List all custom reports in the workspace */
    get: operations['CustomReportsController_findAll'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/customReports/{id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Get a custom report by ID */
    get: operations['CustomReportsController_findOne'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    /** Update active version or enabled flag */
    patch: operations['CustomReportsController_patch'];
    trace?: never;
  };
  '/customReports/{ws_id}/{cr_id}/dist/{path}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Download dist file for the active version of a report */
    get: operations['CustomReportsController_getActiveDistFile'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/customReports/{ws_id}/{cr_id}/versions/{crv_id}/dist/{path}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** Download dist file for a specific version */
    get: operations['CustomReportsController_getVersionDistFile'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
}
export type webhooks = Record<string, never>;
export interface components {
  schemas: {
    CustomReportVersionMetadataDtoScan: {
      /** @enum {string} */
      schemaVersion: '1';
      packageFindings: components['schemas']['CustomReportVersionMetadataDtoPackageFinding'][];
    };
    CustomReportVersionMetadataDtoPackageFinding: {
      packageName: string;
      packageVersion: string | null;
      /** @enum {string|null} */
      severity: 'critical' | 'high' | 'moderate' | 'low' | null;
      title: string | null;
      url?: string;
      dependencyPath: string[];
    };
    CustomReportVersionMetadataDtoVersionCreator: {
      /**
       * Format: uuid
       * @example d4e5f6a7-b8c9-0123-defa-123456789012
       */
      id: string;
      /** @example John Doe */
      displayName?: string;
      /** @example false */
      technicalUser?: boolean;
    };
    CustomReportVersionMetadataDto: {
      /**
       * Format: uuid
       * @example c3d4e5f6-a7b8-9012-cdef-012345678912
       */
      id: string;
      /**
       * Format: uuid
       * @example a1b2c3d4-e5f6-7890-abcd-ef1234567890
       */
      wsId: string;
      /**
       * Format: uuid
       * @example b2c3d4e5-f6a7-8901-bcde-f01234567891
       */
      userId: string;
      /**
       * @example READY
       * @enum {string}
       */
      status:
        | 'SCANNING'
        | 'BUILDING'
        | 'READY'
        | 'VULNERABLE'
        | 'REVOKED'
        | 'FAILED';
      /**
       * Format: date-time
       * @example 2026-05-01T12:00:00.000Z
       */
      createdAt: string;
      /** @example my-fancy-barchart */
      packageName: string;
      /** @example My Custom Report */
      title: string;
      /** @example A nice report */
      description: string;
      /** @example 1.2.3 */
      version: string;
      /** @example null */
      buildLog: string | null;
      /** @example null */
      securityScan:
        | components['schemas']['CustomReportVersionMetadataDtoScan']
        | null;
      creator: components['schemas']['CustomReportVersionMetadataDtoVersionCreator'];
    };
    CustomReportResponseDto__schema0:
      | (
          | string
          | number
          | boolean
          | components['schemas']['CustomReportResponseDto__schema0'][]
          | {
              [
                key: string
              ]: components['schemas']['CustomReportResponseDto__schema0'];
            }
        )
      | null;
    CustomReportResponseDtoVersionSummary: {
      /**
       * Format: uuid
       * @example c3d4e5f6-a7b8-9012-cdef-012345678912
       */
      id: string;
      /**
       * @example READY
       * @enum {string}
       */
      status:
        | 'SCANNING'
        | 'BUILDING'
        | 'READY'
        | 'VULNERABLE'
        | 'REVOKED'
        | 'FAILED';
      /**
       * Format: date-time
       * @example 2026-05-01T12:00:00.000Z
       */
      createdAt: string;
      creator: components['schemas']['CustomReportResponseDtoVersionCreator'];
      /** @example My Custom Report */
      title: string | null;
      /** @example Shows portfolio KPIs. */
      description: string | null;
      /** @example 1.0.0 */
      version: string;
      /** @example false */
      aiAssisted: boolean;
    };
    CustomReportResponseDtoVersionCreator: {
      /**
       * Format: uuid
       * @example d4e5f6a7-b8c9-0123-defa-123456789012
       */
      id: string;
      /** @example John Doe */
      displayName?: string;
      /** @example false */
      technicalUser?: boolean;
    };
    CustomReportResponseDto: {
      /**
       * Format: uuid
       * @example b2c3d4e5-f6a7-8901-bcde-f01234567891
       */
      id: string;
      /**
       * Format: uuid
       * @example a1b2c3d4-e5f6-7890-abcd-ef1234567890
       */
      workspaceId: string;
      /**
       * Format: uuid
       * @example a1b2c3d4-e5f6-7890-abcd-ef1234567890
       */
      customReportVersionWorkspaceId: string;
      /** @example my-fancy-barchart */
      packageName: string;
      /** @example false */
      enabled: boolean;
      /**
       * @example {
       *       "fontSize": "16px"
       *     }
       */
      config: {
        [
          key: string
        ]: components['schemas']['CustomReportResponseDto__schema0'];
      } | null;
      /**
       * Format: uuid
       * @description ID of the active version. The corresponding version object is included in the versions array.
       * @example c3d4e5f6-a7b8-9012-cdef-012345678912
       */
      activeVersionId: string;
      versions: components['schemas']['CustomReportResponseDtoVersionSummary'][];
    };
    PatchCustomReportDto: {
      /** Format: uuid */
      customReportVersionId?: string;
      enabled?: boolean;
    };
  };
  responses: never;
  parameters: never;
  requestBodies: never;
  headers: never;
  pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
  HealthcheckController_getStatus: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Service is healthy */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            name?: string;
            version?: string;
          };
        };
      };
    };
  };
  CustomReportVersionsController_upload: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/gzip': Blob;
      };
    };
    responses: {
      /** @description Upload accepted — scan and build job started */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            /** Format: uuid */
            customReportVersionId: string;
          };
        };
      };
      /** @description Wrong content-type or invalid gzip signature */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Missing or invalid JWT */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Insufficient role or permissions */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Body exceeds the size limit */
      413: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  CustomReportVersionsController_getMetadata: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        customReportVersionId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Version metadata */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['CustomReportVersionMetadataDto'];
        };
      };
      /** @description Missing or invalid JWT */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Insufficient role or permissions */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Version not found */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  CustomReportVersionsController_getSource: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        customReportVersionId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Source .tgz stream */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Missing or invalid JWT */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /**
       * @description Version is owned by another workspace
       *
       *     Insufficient role or permissions
       */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Version not found */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  CustomReportVersionsController_getDist: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        customReportVersionId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Dist .tgz stream */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Missing or invalid JWT */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /**
       * @description Version is owned by another workspace
       *
       *     Insufficient role or permissions
       */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Version not found */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Report is VULNERABLE or REVOKED */
      410: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  CustomReportVersionsController_deleteVersion: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Version deleted */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Missing or invalid JWT */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /**
       * @description Version is owned by another workspace
       *
       *     Insufficient role or permissions
       */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Version not found */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  CustomReportsController_findAll: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description List of custom reports */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['CustomReportResponseDto'][];
        };
      };
      /** @description Missing or invalid JWT */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  CustomReportsController_findOne: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Custom report */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['CustomReportResponseDto'];
        };
      };
      /** @description Missing or invalid JWT */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Not found */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  CustomReportsController_patch: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['PatchCustomReportDto'];
      };
    };
    responses: {
      /** @description Updated custom report */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['CustomReportResponseDto'];
        };
      };
      /** @description Invalid request body */
      400: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Missing or invalid JWT */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Insufficient role or permissions */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Not found */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Version not eligible for activation */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  CustomReportsController_getActiveDistFile: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        ws_id: string;
        cr_id: string;
        path: string[];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description File stream */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Report is disabled */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Not found */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Active version is VULNERABLE or REVOKED */
      410: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  CustomReportsController_getVersionDistFile: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        ws_id: string;
        cr_id: string;
        crv_id: string;
        path: string[];
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description File stream */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Not found */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Version is VULNERABLE or REVOKED */
      410: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
}
