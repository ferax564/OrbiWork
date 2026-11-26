import { SourceControlProviderKind } from "@orbiwork/contracts";
import { describe, expect, it } from "vite-plus/test";

import { appSignInTargetForRemote, sourceControlClients } from "./sourceControlClients.ts";

const parse = (url: string) => {
  const parsed = sourceControlClients.parseChangeRequestUrl(url);
  if (parsed === null) return null;
  const { repositoryUrl: _repositoryUrl, ...link } = parsed.link;
  return link;
};
const kindOf = (url: string) => sourceControlClients.parseChangeRequestUrl(url)?.definition.kind;

describe("sourceControlClients.parseChangeRequestUrl", () => {
  it("reads a GitHub pull request, lower-casing the repository", () => {
    expect(parse("https://github.com/Ferax564/OrbiWork/pull/123")).toEqual({
      host: "github.com",
      repository: "ferax564/orbiwork",
      number: 123,
    });
  });

  it("reads a GitHub pull request on any host, so GitHub Enterprise works on its own name", () => {
    expect(parse("https://code.github.example.com/acme/web/pull/42")).toEqual({
      host: "code.github.example.com",
      repository: "acme/web",
      number: 42,
    });
    expect(kindOf("https://scm.example.test/acme/web/pull/42")).toBe("github");
    expect(
      sourceControlClients.changeRequestUrlFromReferenceAutolink(
        "https://code.github.example.com/acme/web/issues/42",
      ),
    ).toBe("https://code.github.example.com/acme/web/pull/42");
  });

  it("reads a GitLab merge request on any host, nested groups and all", () => {
    expect(parse("https://gitlab.com/orbiwork/platform/orbiwork/-/merge_requests/42")).toEqual({
      host: "gitlab.com",
      repository: "orbiwork/platform/orbiwork",
      number: 42,
    });
    expect(parse("https://code.acme.test/team/project/-/merge_requests/9")).toEqual({
      host: "code.acme.test",
      repository: "team/project",
      number: 9,
    });
    expect(
      sourceControlClients.changeRequestUrlFromReferenceAutolink(
        "https://gitlab.com/team/apps/web/-/merge_requests/42",
      ),
    ).toBe("https://gitlab.com/team/apps/web/-/merge_requests/42");
  });

  it("survives trailing segments, a trailing slash and a query string", () => {
    expect(parse("https://github.com/ferax564/orbiwork/pull/123/files?w=1")).toEqual({
      host: "github.com",
      repository: "ferax564/orbiwork",
      number: 123,
    });
    expect(parse("https://github.com/ferax564/orbiwork/pull/123/")).toEqual({
      host: "github.com",
      repository: "ferax564/orbiwork",
      number: 123,
    });
  });

  it("claims nothing it cannot be sure of", () => {
    for (const link of [
      "https://github.com/ferax564/orbiwork/issues/123",
      "https://github.com/ferax564/orbiwork/commit/0a1b2c3",
      "https://github.com/ferax564/orbiwork",
      "https://github.com/ferax564/orbiwork/pull/abc",
      "https://gitlab.com/ferax564/orbiwork/-/issues/12",
      "https://blog.example.test/2026/updates/archive/pull/3",
      "https://scm.example.test/tfs/Collection/Project/_git/Repo",
      "https://scm.example.test/tfs/Collection/Project/pullrequest/123",
      "https://scm.example.test/tfs/Collection/Project/_git/Repo/pullrequest/abc",
      "https://scm.example.test/tfs/Collection/Project/_git/Repo/pullrequest/0",
      "https://scm.example.test/tfs/Collection/Project/_git/Repo/pullrequest/9007199254740992",
      "ftp://scm.example.test/tfs/Collection/Project/_git/Repo/pullrequest/123",
      "javascript:alert(1)//github.com/ferax564/orbiwork/pull/1",
      "not a url",
    ]) {
      expect(parse(link), link).toBeNull();
    }
  });
});

describe("sourceControlClients.isSameChangeRequest", () => {
  const linked = "https://github.com/ferax564/orbiwork/pull/42";

  it("matches the same pull request whatever its case or trailing path", () => {
    expect(
      sourceControlClients.isSameChangeRequest(
        linked,
        "https://github.com/Ferax564/OrbiWork/pull/42/files",
      ),
    ).toBe(true);
  });
});

describe("change request URLs built from a parsed link", () => {
  const sibling = (url: string, number: number) => {
    const parsed = sourceControlClients.parseChangeRequestUrl(url)!;
    return parsed.definition.changeRequestUrl({
      host: parsed.link.host,
      repository: parsed.link.repository,
      number,
      webUrl: parsed.link.repositoryUrl,
    });
  };

  it.each([
    ["https://github.com/pull/1/pull/42/files", "https://github.com/pull/1/pull/43"],
    [
      "https://gitlab.com/team/web/-/merge_requests/42/diffs",
      "https://gitlab.com/team/web/-/merge_requests/43",
    ],
  ])("builds a canonical sibling of %s", (url, expected) => {
    expect(sibling(url, 43)).toBe(expected);
  });
});

describe("sourceControlClients.recognizeRemote", () => {
  const kindOfRemote = (url: string) => sourceControlClients.recognizeRemote(url)?.kind ?? null;

  it("asks hosts in a fixed order when one hostname carries several hosts' labels", () => {
    expect(kindOfRemote("https://gitlab.github.example/o/r")).toBe("github");
    expect(kindOfRemote("https://bitbucket.gitlab.example/o/r")).toBe("gitlab");
  });

  it("reads a remote no host claims as an unknown host, and a local path as no host", () => {
    expect(
      sourceControlClients.recognizeRemote("https://self-hosted.example.test:8443/group/repo.git"),
    ).toEqual({
      kind: "unknown",
      name: "self-hosted.example.test:8443",
      baseUrl: "https://self-hosted.example.test:8443",
    });
    expect(sourceControlClients.recognizeRemote("git@github-work:owner/repo.git")).toEqual({
      kind: "unknown",
      name: "github-work",
      baseUrl: "https://github-work",
    });
    for (const local of ["/srv/git/repo.git", "C:/repos/project", "file:///srv/git/repo.git", ""]) {
      expect(sourceControlClients.recognizeRemote(local), local).toBeNull();
    }
  });
});

describe("sourceControlClients repository keys", () => {
  // Persisted as `repositoryIdentity.canonicalKey` and in thread pull request keys.
  it.each([
    ["git@github.com:Ferax564/OrbiWork.git", "github.com/ferax564/orbiwork"],
    ["ssh://git@gitlab.company.com:2222/team/project.git", "gitlab.company.com/team/project"],
    ["C:/repos/project", "c:/repos/project"],
  ])("keys %s as %s", (remote, key) => {
    expect(sourceControlClients.repositoryKeyFromRemote(remote)).toBe(key);
  });
});

describe("sourceControlClients project hosts", () => {
  const identity = {
    canonicalKey: "forge.example/team/repo",
    locator: { remoteUrl: "http://forge.example:3000/team/repo.git" },
  };

  it("keys change requests by the repository's host, and falls back to the kind without a key", () => {
    expect(sourceControlClients.changeRequestHost(identity, "gitlab")).toBe("forge.example");
    expect(sourceControlClients.changeRequestHost(identity, undefined)).toBe("forge.example");
    expect(
      sourceControlClients.changeRequestHost(
        { locator: { remoteUrl: "https://x.example/a/b" } },
        "github",
      ),
    ).toBe("github");
  });

  it("selects a repository by its path", () => {
    const repository = {
      displayName: "group/subgroup/service",
      owner: "group",
      name: "service",
    };
    expect(sourceControlClients.repositorySelector(repository)).toBe("group/subgroup/service");
    expect(
      sourceControlClients.repositorySelector({
        ...repository,
        provider: SourceControlProviderKind.make("gitlab"),
      }),
    ).toBe("group/subgroup/service");
    expect(sourceControlClients.repositorySelector({ owner: "o", name: "r" })).toBe("o/r");
  });

  it.each([
    ["https://github.com/acme/web.git", "https://github.com/me/web.git", true],
    ["git@github.com:acme/web.git", "https://github.com/me/web.git", true],
    ["https://github.com/acme/web.git", "https://gitlab.com/me/web.git", false],
    ["https://github.com/acme/web.git", "https://github.com:8443/me/web.git", false],
    ["git@github.com:acme/web.git", "https://github.com:8443/me/web.git", false],
    ["http://github.com/acme/web.git", "https://github.com/me/web.git", false],
  ] as const)(
    "reads a fork's issues beside upstream %s's only when origin %s is on its server",
    (remoteUrl, originUrl, both) => {
      const identity = {
        canonicalKey: "github.com/acme/web",
        locator: { source: "git-remote" as const, remoteName: "upstream", remoteUrl },
        provider: SourceControlProviderKind.make("github"),
        displayName: "acme/web",
        origin: { canonicalKey: `${new URL(originUrl).hostname}/me/web`, remoteUrl: originUrl },
      };
      expect(sourceControlClients.issueBindings(identity).map((binding) => binding.scope)).toEqual(
        both ? ["acme/web", "me/web"] : ["acme/web"],
      );
    },
  );
});

describe("sourceControlClients.findByPublicDomain", () => {
  it("names the host a link is on, subdomains included", () => {
    const kindOf = (hostname: string) => sourceControlClients.findByPublicDomain(hostname)?.kind;
    expect(kindOf("gist.github.com")).toBe("github");
    expect(kindOf("GitLab.com")).toBe("gitlab");
    expect(kindOf("codeberg.org")).toBeUndefined();
    expect(kindOf("notgithub.com")).toBeUndefined();
    expect(kindOf("github.com.example")).toBeUndefined();
  });

  it("leaves findByPublicHost to the public host alone", () => {
    expect(sourceControlClients.findByPublicHost("gist.github.com")).toBeUndefined();
  });
});

describe("hosts OrbiWork no longer integrates with", () => {
  // Projects, links and settings saved before a forge was removed still name it.
  it.each(["azure-devops", "bitbucket", "forgejo", "gitcafe", "cursor-origin", "tanstack-source"])(
    "reads %s as an unknown host",
    (kind) => {
      expect(sourceControlClients.find(kind)).toBeUndefined();
      expect(sourceControlClients.get(kind).kind).toBe("unknown");
      expect(
        sourceControlClients.repositorySelector({
          provider: SourceControlProviderKind.make(kind),
          displayName: "team/web",
        }),
      ).toBe("team/web");
    },
  );

  it.each([
    "https://bitbucket.org/team/web/pull-requests/5",
    "https://dev.azure.com/acme/platform/_git/web/pullrequest/17",
    "https://codeberg.org/team/web/pulls/7",
  ])("links nothing for %s", (url) => {
    expect(sourceControlClients.parseChangeRequestUrl(url)).toBeNull();
  });
});

describe("appSignInTargetForRemote", () => {
  it("names the repository a GitHub remote points at, in the remote's casing", () => {
    for (const remote of [
      "https://github.com/octocat/Hello-World.git",
      "git@github.com:octocat/Hello-World.git",
    ]) {
      expect(appSignInTargetForRemote(remote)?.input).toEqual({
        provider: "github",
        host: "github.com",
        repository: "octocat/Hello-World",
      });
    }
  });

  it("skips hosts the app is not registered on", () => {
    expect(appSignInTargetForRemote("https://ghe.acme.test/acme/web.git")).toBeNull();
    expect(appSignInTargetForRemote("https://gitlab.com/acme/web.git")).toBeNull();
  });
});
