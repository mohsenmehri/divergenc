/* FAM Next product schema. Execute only with the Designer migration identity. */
SET XACT_ABORT ON;
BEGIN TRANSACTION;

CREATE TABLE dbo.Tenants (
  Id uniqueidentifier NOT NULL PRIMARY KEY,
  Code nvarchar(64) NOT NULL UNIQUE,
  Name nvarchar(160) NOT NULL,
  Enabled bit NOT NULL CONSTRAINT DF_Tenants_Enabled DEFAULT 1,
  CreatedAt datetime2(3) NOT NULL CONSTRAINT DF_Tenants_CreatedAt DEFAULT sysutcdatetime()
);

CREATE TABLE dbo.ApplicationUsers (
  Id uniqueidentifier NOT NULL PRIMARY KEY,
  TenantId uniqueidentifier NOT NULL REFERENCES dbo.Tenants(Id),
  Username nvarchar(80) NOT NULL,
  PasswordHash nvarchar(512) NOT NULL,
  PasswordSalt varbinary(32) NOT NULL,
  Enabled bit NOT NULL CONSTRAINT DF_ApplicationUsers_Enabled DEFAULT 1,
  CreatedAt datetime2(3) NOT NULL CONSTRAINT DF_ApplicationUsers_CreatedAt DEFAULT sysutcdatetime(),
  CONSTRAINT UQ_ApplicationUsers_Tenant_Username UNIQUE (TenantId, Username)
);

CREATE TABLE dbo.UserRoles (
  TenantId uniqueidentifier NOT NULL REFERENCES dbo.Tenants(Id),
  UserId uniqueidentifier NOT NULL REFERENCES dbo.ApplicationUsers(Id),
  Role nvarchar(40) NOT NULL,
  CONSTRAINT PK_UserRoles PRIMARY KEY (TenantId, UserId, Role),
  CONSTRAINT CK_UserRoles_Role CHECK (Role IN ('TenantAdmin','DataManager','RegionalManager','Operator','Viewer','Auditor'))
);

CREATE TABLE dbo.Worksheets (
  Id uniqueidentifier NOT NULL PRIMARY KEY,
  TenantId uniqueidentifier NOT NULL REFERENCES dbo.Tenants(Id),
  Name nvarchar(128) NOT NULL,
  DefinitionJson nvarchar(max) NOT NULL,
  Version rowversion NOT NULL,
  Enabled bit NOT NULL CONSTRAINT DF_Worksheets_Enabled DEFAULT 1,
  CONSTRAINT UQ_Worksheets_Tenant_Name UNIQUE (TenantId, Name)
);

CREATE TABLE dbo.WorksheetRows (
  Id uniqueidentifier NOT NULL PRIMARY KEY,
  TenantId uniqueidentifier NOT NULL REFERENCES dbo.Tenants(Id),
  WorksheetId uniqueidentifier NOT NULL REFERENCES dbo.Worksheets(Id),
  RegionCode nvarchar(64) NULL,
  DataJson nvarchar(max) NOT NULL,
  CreatedBy uniqueidentifier NOT NULL REFERENCES dbo.ApplicationUsers(Id),
  CreatedAt datetime2(3) NOT NULL CONSTRAINT DF_WorksheetRows_CreatedAt DEFAULT sysutcdatetime(),
  UpdatedBy uniqueidentifier NOT NULL REFERENCES dbo.ApplicationUsers(Id),
  UpdatedAt datetime2(3) NOT NULL CONSTRAINT DF_WorksheetRows_UpdatedAt DEFAULT sysutcdatetime(),
  Version rowversion NOT NULL
);
CREATE INDEX IX_WorksheetRows_Tenant_Worksheet ON dbo.WorksheetRows(TenantId, WorksheetId, Id);

CREATE TABLE dbo.ImportBatches (
  Id uniqueidentifier NOT NULL PRIMARY KEY,
  TenantId uniqueidentifier NOT NULL REFERENCES dbo.Tenants(Id),
  ActorUserId uniqueidentifier NOT NULL REFERENCES dbo.ApplicationUsers(Id),
  OriginalFileName nvarchar(260) NOT NULL,
  Sha256 char(64) NOT NULL,
  Status nvarchar(24) NOT NULL,
  AcceptedRows int NOT NULL CONSTRAINT DF_ImportBatches_AcceptedRows DEFAULT 0,
  RejectedRows int NOT NULL CONSTRAINT DF_ImportBatches_RejectedRows DEFAULT 0,
  CreatedAt datetime2(3) NOT NULL CONSTRAINT DF_ImportBatches_CreatedAt DEFAULT sysutcdatetime(),
  CompletedAt datetime2(3) NULL,
  CONSTRAINT CK_ImportBatches_Status CHECK (Status IN ('staged','validated','committed','rejected','rolled_back'))
);

CREATE TABLE dbo.AuditEvents (
  Id bigint IDENTITY(1,1) NOT NULL PRIMARY KEY,
  TenantId uniqueidentifier NOT NULL REFERENCES dbo.Tenants(Id),
  ActorUserId uniqueidentifier NULL REFERENCES dbo.ApplicationUsers(Id),
  EventType nvarchar(80) NOT NULL,
  EntityType nvarchar(80) NOT NULL,
  EntityId nvarchar(128) NULL,
  DetailsJson nvarchar(max) NOT NULL,
  OccurredAt datetime2(3) NOT NULL CONSTRAINT DF_AuditEvents_OccurredAt DEFAULT sysutcdatetime()
);
CREATE INDEX IX_AuditEvents_Tenant_Time ON dbo.AuditEvents(TenantId, OccurredAt DESC);

CREATE TABLE dbo.Licenses (
  Id uniqueidentifier NOT NULL PRIMARY KEY,
  TenantId uniqueidentifier NOT NULL REFERENCES dbo.Tenants(Id),
  SignedPayload nvarchar(max) NOT NULL,
  ExpiresAt datetime2(3) NOT NULL,
  Enabled bit NOT NULL CONSTRAINT DF_Licenses_Enabled DEFAULT 1
);

COMMIT TRANSACTION;
