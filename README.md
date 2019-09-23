# Orchard Core Translations

Orchard Core translations provide two kinds of NuGet packages:

- __Culture Specific Packages__: A NuGet package that targets a single culture, named `OrchardCore.Translation.{culture}.nupkg` where `{culture}` is the culture it contains.
- __Translations Meta Package__: A NuGet package named `OrchardCore.Translation.All.nupkg` which references all translation packages that Orchard Core supports out of the box.

Crowdin Translations: 

[![Crowdin](https://d322cqt584bo4o.cloudfront.net/orchard-core/localized.svg)](https://crowdin.com/project/orchard-core)

## Build Status

Stable (master): 

[![Build status](https://img.shields.io/appveyor/ci/SebastienRos/orchardcore-translations/master.svg?label=appveyor&style=flat-square)](https://ci.appveyor.com/project/SebastienRos/orchardcore-translations/branch/master)

Nightly (dev): 

[![Build status](https://img.shields.io/appveyor/ci/SebastienRos/orchardcore-translations/dev.svg?label=appveyor&style=flat-square)](https://ci.appveyor.com/project/SebastienRos/orchardcore-translations/branch/dev)
