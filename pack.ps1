$artifactsFolderName = "artifacts"
$localizationFolderName = "Localization"

$cultures = New-Object Collections.Generic.List[String]

$pkgExtension = "nupkg"
$pkgNamePrefix = "OrchardCore.Translations."
$pkgVersion = $env:nugetVersion
$pkgTitle = "Orchard Core translations for '{0}' culture"
$pkgDescription = "Orchard Core CMS is a Web Content Management System (CMS) built on top of the Orchard Core Framework.

Orchard Core translations for '{0}' ({1}) culture"

$pkgSpecExtension = "nuspec"
$pkgPropsExtension = "props"
$pkgBuildFolderName = "buildTransitive"
$pkgSpecTemplate = "_template.$pkgSpecExtension"
$pkgPropsTemplate = "_template.$pkgPropsExtension"

function createNuGetPackage([string]$pkgName, [string]$culture, [string]$cultureDisplayName)
{
    echo "Copying content files .."

    $pkgId = "$pkgName.$pkgVersion"
    $pkgFolderPath = [IO.Path]::Combine($artifactsFolderName, $pkgId)   

    $pkgContentFolderPath = [IO.Path]::Combine($pkgFolderPath, "content")
    New-Item -Path $pkgContentFolderPath -ItemType "Directory" | Out-Null
    
    $pkgCultureFolderPath = [IO.Path]::Combine($pkgContentFolderPath, $localizationFolderName, $culture)
    $cultureFolder = [IO.Path]::Combine($localizationFolderName, $culture)
    Copy-Item -Path $cultureFolder -Destination $pkgCultureFolderPath -Recurse
    
    echo "Copying '$pkgName.$pkgPropsExtension' ..."

    $pkgBuildFolderPath = [IO.Path]::Combine($pkgFolderPath, $pkgBuildFolderName)
    New-Item -Path $pkgBuildFolderPath -ItemType "Directory" | Out-Null
    
    $pkgPropsFileName = "$pkgName.$pkgPropsExtension"
    $pkgPropsFilePath = [IO.Path]::Combine($pkgBuildFolderPath, $pkgPropsFileName)
    Copy-Item -Path $pkgPropsTemplate -Destination $pkgPropsFilePath

    buildNuGetPackageSpec $pkgName $culture $cultureDisplayName
    
    $pkgSpecFileName = "$pkgName.$pkgSpecExtension"
    $pkgSpecFilePath = [IO.Path]::Combine($env:GITHUB_WORKSPACE, $pkgFolderPath, $pkgSpecFileName)
    $csprojFilePath = "$env:GITHUB_WORKSPACE/.github/workflows/project.csproj"
    $pkgDestinationPath = [IO.Path]::Combine($env:GITHUB_WORKSPACE, $pkgFolderPath)

    $icon = [IO.Path]::Combine($pkgFolderPath, "icon.png")
    Copy-Item -Path "$env:GITHUB_WORKSPACE/.github/workflows/nuget-icon.png" -Destination $icon

    dotnet pack $csprojFilePath -p:NuspecFile=$pkgSpecFilePath -p:PackageOutputPath=$pkgDestinationPath # | Out-Null
}

function createNuGetMetaPackage()
{
    $pkgName = $pkgNamePrefix + "All"
    $pkgId = "$pkgName.$pkgVersion"

    echo "Creating '$pkgId.$pkgExtension' ..."

    buildNuGetMetaPackageSpec $pkgName
    
    $pkgSpecFileName = "$pkgName.$pkgSpecExtension"
    $pkgSpecFilePath = [IO.Path]::Combine($env:GITHUB_WORKSPACE, $artifactsFolderName, $pkgSpecFileName)
    $csprojFilePath = "$env:GITHUB_WORKSPACE/.github/workflows/project.csproj"
    $pkgDestinationPath = [IO.Path]::Combine($env:GITHUB_WORKSPACE, $pkgFolderPath)
    $pkgFolderPath = [IO.Path]::Combine($artifactsFolderName, $pkgId)

    echo "Project file in '$csprojFilePath'"

    dotnet pack $csprojFilePath -p:NuspecFile=$pkgSpecFilePath -p:PackageOutputPath=$pkgDestinationPath # | Out-Null
}

function buildNuGetPackageSpec($pkgName, $culture, $cultureDisplayName)
{
    echo "Building '$pkgName.$pkgSpecExtension' ..."

    $pkgSpecDocument = [xml](Get-Content -Path $pkgSpecTemplate)
    $metadata = $pkgSpecDocument.package.metadata
    $metadata.id = $pkgName
    $metadata.version = $pkgVersion
    $metadata.title = [String]::Format($pkgTitle, $cultureDisplayName)
    $metadata.description = [String]::Format($pkgDescription, $cultureDisplayName, $culture)
    
    $pkgId = $pkgNamePrefix + $culture
    $pkgFolderPath = [IO.Path]::Combine($artifactsFolderName, "$pkgId.$pkgVersion")
    $pkgSpecFilePath = [IO.Path]::Combine($PWD, $pkgFolderPath, "$pkgId.$pkgSpecExtension")
    $pkgSpecDocument.Save($pkgSpecFilePath)

    echo "File '$pkgSpecFilePath' built"
}

function buildNuGetMetaPackageSpec($pkgName)
{
    echo "Building '$pkgName.$pkgSpecExtension' ..."

    $pkgSpecDocument = [xml](Get-Content -Path $pkgSpecTemplate)
    $metadata = $pkgSpecDocument.package.metadata
    $metadata.id = $pkgName
    $metadata.version = $pkgVersion
    $metadata.title = "Orchard Core Translations for All cultures"
    $metadata.description = "Orchard Core CMS is a Web Content Management System (CMS) built on top of the Orchard Core Framework.
    
    Orchard Core translation for all supported cultures"

    $dependencies = $pkgSpecDocument.CreateElement("dependencies")
    $dependencies.RemoveAllAttributes()
    
    foreach($culture in $cultures)
    {
        $dependency = $pkgSpecDocument.CreateElement("dependency")
        $dependency.SetAttribute("id", $pkgNamePrefix + $culture)
        $dependency.SetAttribute("version", $pkgVersion)
        $dependencies.AppendChild($dependency) | Out-Null
    }

    $metadata.AppendChild($dependencies) | Out-Null

    $pkgId = $pkgNamePrefix + "All"
    $pkgSpecFilePath = [IO.Path]::Combine($PWD, $artifactsFolderName, "$pkgId.$pkgSpecExtension")
    $pkgSpecDocument.Save($pkgSpecFilePath)
}

echo "Start generating translations NuGet packages"
echo ""

$json = Get-Content -Raw -Path cultures.json | ConvertFrom-Json

foreach ($culture in $json.cultures)
{
    $cultureName = $culture.name
    $cultureDisplayName = $culture.'display-name'
   
    if($culture.'generate-package')
    {
        $pkgName = $pkgNamePrefix + $cultureName
        $pkgId = "$pkgName.$pkgVersion"
        
        echo "Preparing a NuGet package for '$($culture.'display-name')' culture"
        echo "Creating '$pkgId.$pkgExtension' ..."

        createNuGetPackage $pkgName $cultureName $cultureDisplayName

        echo ""
    }

    if($culture.'meta-package')
    {
        $cultures.Add($cultureName)
    }
}

echo "Creating translations meta package ..."
createNuGetMetaPackage

echo ""
echo "Translations NuGet packages created successfully!!"
