$packagesFolder = "NuGet Packages"
$localizationFolder = "Localization"

$packageExtension = ".nupkg"
$packageNamePrefix = "OrchardCore.Translations."
$PackageVersionNumber = "1.0.0" # Find a proper way to get version number

$packageSpecExtension = ".nuspec"
$packageSpecTemplate = "_template" + $packageSpecExtension

Write-Host "Start generating translation NuGet packages ..."

createNuGetPackagesFolder;

foreach($cultureFolder in $(Get-ChildItem $localizationFolder)) {
    createNuGetPackage $cultureFolder.Name;
    break;
}

echo "Done!!";

function createNuGetPackagesFolder()
{
    if(-Not(Test-Path -Path $packagesFolder))
    {
        New-Item -Path $packagesFolder -ItemType "Directory"
    }
    else
    {
        Remove-Item -Path $packagesFolder\* -Recurse -Force
    }
}

function createNuGetPackage([string]$culture)
{
    Write-Host "Creating '$packageName' NuGet package"

    $packageName = $packageNamePrefix + $culture;
    $NuGetSpecFileName = $packageName + $packageSpecExtension;
    $NuGetSpecFilePath = [IO.Path]::Combine($PWD, $localizationFolder, $culture, $NuGetSpecFileName);

    $PackageFolderPath = [IO.Path]::Combine($packagesFolder, "$packageName.$PackageVersionNumber")
    $contentFolderPath = [IO.Path]::Combine($PackageFolderPath, "content")
    $localizationFolderPath = [IO.Path]::Combine($contentFolderPath, $localizationFolder)
    
    New-Item -Path $PackageFolderPath -ItemType "Directory"
    New-Item -Path $contentFolderPath -ItemType "Directory"
    New-Item -Path $localizationFolderPath -ItemType "Directory"
    
    $cultureFolder = [IO.Path]::Combine($localizationFolder, $culture)
    $cultureFolderPath = [IO.Path]::Combine($localizationFolderPath, $culture)
    Copy-Item -Path $cultureFolder -Destination $cultureFolderPath -Recurse

    prepareNuGetSpec $culture;

    $packageFullName = "$packageName.$PackageVersionNumber.$packageExtension"
    $packagePath = [IO.Path]::Combine($packagesFolder, $packageFullName)
    $compressedCultureFileName = "$packageName.$PackageVersionNumber.zip"
    $compressedCulturePath = [IO.Path]::Combine($packagesFolder, $compressedCultureFileName)
    $cultureFolder = [IO.Path]::Combine($PWD, $localizationFolder, $culture);

    Compress-Archive -Path $PackageFolderPath -DestinationPath "$PackageFolderPath.zip" -CompressionLevel Optimal -Update
    Rename-Item "$PackageFolderPath.zip" $packageFullName
    Remove-Item -Path $PackageFolderPath -Recurse

    Write-Host
}

function prepareNuGetSpec([string]$culture)
{
    $PackageFolderPath = [IO.Path]::Combine($packagesFolder, "$packageName.$PackageVersionNumber")

    $packageName = $packageNamePrefix + $culture
    $NuGetSpecFileName = $packageName + $packageSpecExtension
    $NuGetSpecFilePath = [IO.Path]::Combine($PWD, $PackageFolderPath, $NuGetSpecFileName)

    $nugetSpec = [xml](Get-Content -Path $packageSpecTemplate)
    $metadata = $nugetSpec.package.metadata
    $metadata.id = $packageName
    $metadata.version = $PackageVersionNumber
    $metadata.authors = "Hisham Bin Ateya"
    $metadata.owners = "Orchard Core Team"
    $metadata.description = "Orchard Core translation for '$culture' culture"
    $nugetSpec.Save($NuGetSpecFilePath)
}