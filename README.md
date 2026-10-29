# Orchard Core Translations

[![Publish Preview Packages](https://github.com/OrchardCMS/OrchardCore.Translations/actions/workflows/stage.yml/badge.svg)](https://github.com/OrchardCMS/OrchardCore.Translations/actions/workflows/stage.yml)

Orchard Core translations provide two kinds of NuGet packages:

- __Culture Specific Packages__: A NuGet package that targets a single culture, named `OrchardCore.Translation.{culture}.nupkg` where `{culture}` is the culture it contains.
- __Translations Meta Package__: A NuGet package named `OrchardCore.Translation.All.nupkg` which references all translation packages that Orchard Core supports out of the box.

Crowdin Translations: 

[![Crowdin](https://d322cqt584bo4o.cloudfront.net/orchard-core/localized.svg)](https://crowdin.com/project/orchard-core)

## Automatic POT Updates

The **Sync POT files** GitHub Actions workflow runs every Monday at 03:00 UTC and
can also be started manually using **Run workflow** in the Actions tab. It clones
the `main` branch of `OrchardCMS/OrchardCore`, replaces `Localization/*.pot` with
the upstream templates (including removing obsolete templates), and creates or
updates a pull request if Git detects changes. Translated `.po` files are not changed.

The repository's **Settings > Actions > General > Workflow permissions** must
allow GitHub Actions to create pull requests. The workflow uses `GITHUB_TOKEN`
with write permissions for repository contents and pull requests.

## Release Walkthrough

The following steps are needed to release new Orchard Core Translations NuGet packages:

1. Install or update [PO Extractor](https://github.com/OrchardCoreContrib/OrchardCoreContrib.PoExtractor):
   `dotnet tool install --global OrchardCoreContrib.PoExtractor`
2. Check out this reporsitory and the main Orchard Core repository into separate folders (e.g. C:\Orchard\OrchardCore and C:\Orchard\OrchardCore.Translations).
3. Run PO Extractor to save the new .pot files into the [Localization](https://github.com/OrchardCMS/OrchardCore.Translations/tree/main/Localization) folder like this:
   `extractpo C:\Orchard\OrchardCore and C:\Orchard\OrchardCore.Translations`
4. Go to https://crowdin.com/project/orchard-core.
5. Then go to Integrations > GitHub and click the "Sync Now" button.
6. Go to https://github.com/OrchardCMS/OrchardCore.Translations/pulls.
7. Find the "New Crowdin updates" pull request.
8. Review and merge it.
9. push a new version tag to this repository, such as `v3.0.0`.
