function fail(message) {
  throw new Error(message);
}

function desiredLinksFromPlan(plan) {
  const bundleLinks = (plan.packageUploads ?? []).map((upload) => ({
    name: upload.releaseAssetName,
    url: upload.packageUrl,
    directAssetPath: upload.releaseAssetFilepath,
    linkType: "package",
  }));

  return [
    ...bundleLinks,
    {
      name: "MyNote updater manifest",
      url: plan.latestManifestPackageUrl,
      directAssetPath: plan.latestManifestReleaseFilepath,
      linkType: "package",
    },
  ];
}

function directAssetUrlMatches(link, directAssetPath) {
  const directAssetUrl = link.direct_asset_url ?? "";
  return directAssetUrl.endsWith(`/downloads${directAssetPath}`);
}

export function buildGitLabUpdaterUploadPlan(plan) {
  if (!plan?.manifestOutputPath || !plan?.latestManifestPackageUrl) {
    fail("A valid updater plan is required.");
  }

  return [
    ...(plan.packageUploads ?? []).map((upload) => ({
      localPath: upload.localPath,
      packageUrl: upload.packageUrl,
    })),
    {
      localPath: plan.manifestOutputPath,
      packageUrl: plan.latestManifestPackageUrl,
    },
  ];
}

export function buildGitLabReleaseLinkSyncPlan(plan, existingLinks) {
  const desiredLinks = desiredLinksFromPlan(plan);
  const links = Array.isArray(existingLinks) ? existingLinks : [];
  const operations = [];

  for (const desired of desiredLinks) {
    const existing = links.find((link) => link.name === desired.name);
    if (!existing) {
      operations.push({
        method: "POST",
        name: desired.name,
        url: desired.url,
        directAssetPath: desired.directAssetPath,
        linkType: desired.linkType,
      });
      continue;
    }

    const needsUpdate = existing.url !== desired.url || !directAssetUrlMatches(existing, desired.directAssetPath);
    if (!needsUpdate) {
      continue;
    }

    operations.push({
      method: "PUT",
      linkId: existing.id,
      name: desired.name,
      url: desired.url,
      directAssetPath: desired.directAssetPath,
      linkType: desired.linkType,
    });
  }

  return operations;
}