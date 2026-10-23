namespace FamNext.Domain;

public enum ProductRole
{
    Designer,
    TenantAdmin,
    DataManager,
    RegionalManager,
    Operator,
    Viewer,
    Auditor
}

public enum ProductPermission
{
    ViewSheet,
    SearchData,
    EditRecord,
    ImportData,
    ExportData,
    ViewAudit,
    ManageTenantUsers,
    ManageTenantScopes,
    ManageSheetDefinitions,
    NetworkRead,
    NetworkOperate
}

public sealed record TenantId(Guid Value)
{
    public static TenantId New() => new(Guid.NewGuid());
}

public sealed record UserScope(
    TenantId TenantId,
    Guid UserId,
    IReadOnlySet<ProductPermission> Permissions,
    IReadOnlySet<string> Regions,
    IReadOnlySet<Guid> WorksheetIds);

public sealed record ImportUpload(
    TenantId TenantId,
    Guid ActorUserId,
    string OriginalFileName,
    string ContentType,
    long Length,
    Stream Content);

public sealed record ImportPreview(
    Guid BatchId,
    int AcceptedRows,
    int RejectedRows,
    IReadOnlyList<string> Headers,
    IReadOnlyList<ImportError> Errors);

public sealed record ImportError(int RowNumber, string Field, string Message);

public sealed record SignedLicense(
    string ProductCode,
    Guid TenantId,
    DateTimeOffset NotBefore,
    DateTimeOffset ExpiresAt,
    int MaximumUsers,
    IReadOnlySet<string> Features,
    string Signature);
