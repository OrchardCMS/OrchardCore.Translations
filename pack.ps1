$artifactsFolderName = "artifacts"
$localizationFolderName = "Localization"

$pkgExtension = "nupkg"
$pkgNamePrefix = "OrchardCore.Translations."
$pkgVersion = "1.0.0-beta-$env:BuildNumber"
$pkgDescription = "Orchard Core translation for '{0}' culture"

$pkgSpecExtension = "nuspec"
$pkgSpecTemplate = "_template.$pkgSpecExtension"

function createNuGetPackage([string]$pkgName, [string]$culture)
{
    $pkgId = "$pkgName.$pkgVersion"
    $pkgFolderPath = [IO.Path]::Combine($artifactsFolderName, $pkgId)   

    $pkgContentFolderPath = [IO.Path]::Combine($pkgFolderPath, "content")
    New-Item -Path $pkgContentFolderPath -ItemType "Directory"
    
    $pkgCultureFolderPath = [IO.Path]::Combine($pkgContentFolderPath, $localizationFolderName, $culture)

    $cultureFolder = [IO.Path]::Combine($localizationFolderName, $culture)
    Copy-Item -Path $cultureFolder -Destination $pkgCultureFolderPath -Recurse

    buildNuGetSpec $pkgName $culture
    
    $pkgSpecFileName = "$pkgName.$pkgSpecExtension"
    $pkgSpecFilePath = [IO.Path]::Combine($pkgFolderPath, $pkgSpecFileName)
    .\nuget pack $pkgSpecFilePath
  
    $pkgTempFilePath = "$pkgId.$pkgExtension"
    $pkgFilePath = "$pkgFolderPath.$pkgExtension"
    Move-Item -Path $pkgTempFilePath -Destination $pkgFilePath
    Remove-Item -Path $pkgFolderPath -Recurse
}

function buildNuGetSpec($pkgName, $culture)
{
    $pkgSpecDocument = [xml](Get-Content -Path $pkgSpecTemplate)
    $metadata = $pkgSpecDocument.package.metadata
    $metadata.id = $pkgName
    $metadata.version = $pkgVersion
    $metadata.description = [String]::Format($pkgDescription, $culture)
    
    $pkgId = $pkgNamePrefix + $culture
    $pkgFolderPath = [IO.Path]::Combine($artifactsFolderName, "$pkgId.$pkgVersion")
    $pkgSpecFilePath = [IO.Path]::Combine($PWD, $pkgFolderPath, "$pkgId.$pkgSpecExtension")
    $pkgSpecDocument.Save($pkgSpecFilePath)
}

echo "Start generating translations NuGet packages .."

foreach($cultureFolder in $(Get-ChildItem $localizationFolderName -Directory)) {
    $culture = $cultureFolder.Name
    $pkgName = $pkgNamePrefix + $culture   
    
    echo "Creating '$pkgName' NuGet package"

    createNuGetPackage $pkgName $culture
}

echo "Translations NuGet packages created successfully!!"