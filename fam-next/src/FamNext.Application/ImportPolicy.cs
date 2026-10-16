using FamNext.Domain;

namespace FamNext.Application;

/// <summary>Server-only import guard. It treats uploads as data, never code.</summary>
public static class ImportPolicy
{
    public const long MaxUploadBytes = 25 * 1024 * 1024;
    public const int MaxRows = 250_000;
    public const int MaxColumns = 200;

    private static readonly HashSet<string> AllowedExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".csv", ".xlsx"
    };

    public static void Authorize(UserScope scope, ImportUpload upload)
    {
        if (scope.TenantId != upload.TenantId)
            throw new UnauthorizedAccessException("Tenant scope mismatch.");
        if (!scope.Permissions.Contains(ProductPermission.ImportData))
            throw new UnauthorizedAccessException("Import permission is required.");
        if (upload.Length is <= 0 or > MaxUploadBytes)
            throw new InvalidDataException("Upload size is outside the allowed limit.");
        var extension = Path.GetExtension(upload.OriginalFileName);
        if (!AllowedExtensions.Contains(extension))
            throw new InvalidDataException("Only .csv and macro-free .xlsx files are accepted.");
    }
}
