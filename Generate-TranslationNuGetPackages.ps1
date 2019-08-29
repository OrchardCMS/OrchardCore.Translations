$localizationFolder = "Localization";
$culturesFolders = $(Get-ChildItem "$localizationFolder");

$packageExtension = ".nuget";
$packageNamePrefix = "OrchardCore.Translations.";
$PackageVersionNumber = "1.0.0";

$NuGetSpecExtension = ".nuspec";
$NuGetSpecTemplate = "NuGetSpecTemplate" + $NuGetSpecExtension;

$PackagesFolder = "NuGet Packages";

echo "Start generating translation NuGet packages ..";

# Create NuGet folder if not exist
createNuGetFolder;

foreach($cultureFolder in $culturesFolders) {
    # Generate tranlation NuGet package
    createNuGetPackage $cultureFolder.Name;
}

echo "Done!!";

function createNuGetFolder()
{
    if(-Not(Test-Path -Path $PackagesFolder))
    {
        New-Item -Path $PackagesFolder -ItemType "Directory";
    }
    else
    {
        # Remove old translation packages
        Remove-Item -Path $PackagesFolder\* -Recurse -Force;
    }
}

function prepareNuGetSpec($culture)
{
    $packageName = $packageNamePrefix + $culture;
    $NuGetSpecFileName = $packageName + $NuGetSpecExtension;
    $NuGetSpecFilePath = [IO.Path]::Combine($PWD, $localizationFolder, $culture, $NuGetSpecFileName);

    $nugetSpec = [xml](Get-Content -Path $NuGetSpecTemplate);
    $metadata = $nugetSpec.package.metadata;
    $metadata.id = $packageName;
    $metadata.version = $PackageVersionNumber;
    $metadata.authors = "Hisham Bin Ateya";
    $metadata.owners = "Orchard Core Team";
    $metadata.description = "Orchard Core translation for '$culture' culture";
    $nugetSpec.Save($NuGetSpecFilePath);
}

function createNuGetPackage($culture)
{
    echo "Creating '$packageName' NuGet package";

    $packageName = $packageNamePrefix + $culture;
    $NuGetSpecFileName = $packageName + $NuGetSpecExtension;
    $NuGetSpecFilePath = [IO.Path]::Combine($PWD, $localizationFolder, $culture, $NuGetSpecFileName);

    prepareNuGetSpec $culture;

    $packageFullName = "$packageName.$PackageVersionNumber.$packageExtension";
    $packagePath = [IO.Path]::Combine($PackagesFolder, $packageFullName);
    $compressedCultureFileName = "$packageName.$PackageVersionNumber.zip";
    $compressedCulturePath = [IO.Path]::Combine($PackagesFolder, $compressedCultureFileName);
    $cultureFolder = [IO.Path]::Combine($PWD, $localizationFolder, $culture);

    # Create and replace translation package if exists
    Compress-Archive -Path $cultureFolder -DestinationPath $compressedCulturePath -CompressionLevel Optimal -Update;
    Rename-Item $compressedCulturePath $packageFullName;

    # Cleanup
    Remove-Item -Path $NuGetSpecFilePath;
}