$packagesFolder = "MyGet"
$artifactsFolder = "artifacts"
$localizationFolder = "Localization"

$packageExtension = ".nupkg"
$packageNamePrefix = "OrchardCore.Translations."
$packageVersionNumber = "1.0.0"

$packageSpecExtension = ".nuspec"
$packageSpecTemplate = "_template$packageSpecExtension"

$compressedFileExtension = ".zip"

function createNuGetPackage([string]$culture)
{
    $packageName = $packageNamePrefix + $culture;
    $NuGetSpecFileName = $packageName + $packageSpecExtension;
    $NuGetSpecFilePath = [IO.Path]::Combine($PWD, $localizationFolder, $culture, $NuGetSpecFileName);

    $PackageFolderPath = [IO.Path]::Combine($packagesFolder, "$packageName.$packageVersionNumber")
    $contentFolderPath = [IO.Path]::Combine($PackageFolderPath, "content")
    $localizationFolderPath = [IO.Path]::Combine($contentFolderPath, $localizationFolder)

    echo "Creating '$packageName' NuGet package"
    
    New-Item -Path $PackageFolderPath -ItemType "Directory"
    New-Item -Path $contentFolderPath -ItemType "Directory"
    New-Item -Path $localizationFolderPath -ItemType "Directory"
    
    $cultureFolder = [IO.Path]::Combine($localizationFolder, $culture)
    $cultureFolderPath = [IO.Path]::Combine($localizationFolderPath, $culture)
    Copy-Item -Path $cultureFolder -Destination $cultureFolderPath -Recurse

    prepareNuGetSpec $culture;

    $packageFullName = "$packageName.$packageVersionNumber$packageExtension"
    $packagePath = [IO.Path]::Combine($packagesFolder, $packageFullName)
    $compressedCultureFileName = "$packageName.$packageVersionNumber$compressedFileExtension"
    $compressedCulturePath = [IO.Path]::Combine($packagesFolder, $compressedCultureFileName)
    $cultureFolder = [IO.Path]::Combine($PWD, $localizationFolder, $culture);

    Compress-Archive -Path $PackageFolderPath -DestinationPath "$PackageFolderPath$compressedFileExtension" -CompressionLevel Optimal -Update
    Rename-Item "$PackageFolderPath.zip" $packageFullName
    Remove-Item -Path $PackageFolderPath -Recurse
}

function prepareNuGetSpec([string]$culture)
{
    $packageFolderPath = [IO.Path]::Combine($packagesFolder, "$packageName.$packageVersionNumber")

    $packageName = $packageNamePrefix + $culture
    $NuGetSpecFileName = $packageName + $packageSpecExtension
    $NuGetSpecFilePath = [IO.Path]::Combine($PWD, $packageFolderPath, $NuGetSpecFileName)

    $nugetSpec = [xml](Get-Content -Path $packageSpecTemplate)
    $metadata = $nugetSpec.package.metadata
    $metadata.id = $packageName
    $metadata.version = $packageVersionNumber
    $metadata.description = "Orchard Core translation for '$culture' culture"
    $nugetSpec.Save($NuGetSpecFilePath)
}

echo "Start generating translations NuGet packages .."

if(Test-Path -Path $artifactsFolder)
{
    echo "Delete $artifactsFolder folder" 
    Remove-Item -Path $artifactsFolder\* -Recurse -Force
}

New-Item -Path $packagesFolder -ItemType "Directory"

foreach($cultureFolder in $(Get-ChildItem $localizationFolder -Directory)) {
    createNuGetPackage $cultureFolder.Name
}

Move-Item -Path $packagesFolder -Destination $artifactsFolder

echo "Translations NuGet packages created successfully!!"