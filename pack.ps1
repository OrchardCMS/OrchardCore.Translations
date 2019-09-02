$artifactsFolderName = "artifacts"
$localizationFolderName = "Localization"

$pkgExtension = "nupkg"
$pkgNamePrefix = "OrchardCore.Translations."
$pkgVersion = $env:nugetVersion
$pkgDescription = "Orchard Core translation for '{0}' culture"

$pkgSpecExtension = "nuspec"
$pkgSpecTemplate = "_template.$pkgSpecExtension"

function createNuGetPackage([string]$pkgName, [string]$culture)
{
    echo "Copying content files .."

    $pkgId = "$pkgName.$pkgVersion"
    $pkgFolderPath = [IO.Path]::Combine($artifactsFolderName, $pkgId)   

    $pkgContentFolderPath = [IO.Path]::Combine($pkgFolderPath, "content")
    New-Item -Path $pkgContentFolderPath -ItemType "Directory" | Out-Null
    
    $pkgCultureFolderPath = [IO.Path]::Combine($pkgContentFolderPath, $localizationFolderName, $culture)
    $cultureFolder = [IO.Path]::Combine($localizationFolderName, $culture)
    Copy-Item -Path $cultureFolder -Destination $pkgCultureFolderPath -Recurse
    
    buildNuGetSpec $pkgName $culture
    
    $pkgSpecFileName = "$pkgName.$pkgSpecExtension"
    $pkgSpecFilePath = [IO.Path]::Combine($pkgFolderPath, $pkgSpecFileName)
    .\nuget pack $pkgSpecFilePath | Out-Null
  
    $pkgTempFilePath = "$pkgId.$pkgExtension"
    $pkgFilePath = "$pkgFolderPath.$pkgExtension"
    Move-Item -Path $pkgTempFilePath -Destination $pkgFilePath
    Remove-Item -Path $pkgFolderPath -Recurse
}

function buildNuGetSpec($pkgName, $culture)
{
    echo "Building '$pkgName.$pkgSpecExtension' .."

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

echo "Start generating translations NuGet packages"
echo ""

foreach($cultureFolder in $(Get-ChildItem $localizationFolderName -Directory)) {
    $culture = $cultureFolder.Name
    $pkgName = $pkgNamePrefix + $culture
    $pkgId = "$pkgName.$pkgVersion"
    
    echo "Creating '$pkgId.$pkgExtension' .."

    createNuGetPackage $pkgName $culture

    echo ""
}

echo "Translations NuGet packages created successfully!!"