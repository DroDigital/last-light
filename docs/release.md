# Building and releasing LAST LIGHT

The release workflow packages the browser game and desktop apps for itch.io.
It does not create the itch.io game page or change its visibility.

## One-time setup

1. Create the game page on itch.io and note its `account/game` slug (the
   account is the subdomain in the page URL, and the game is the page slug).
2. In the GitHub repository's **Settings → Secrets and variables → Actions**,
   add the repository secret `BUTLER_API_KEY` with an itch.io API key that has
   access to that game. Do not commit the key or place it in a workflow input.
3. Add the repository variable `ITCH_GAME` with the `account/game` slug. A
   manual run can override this value using its optional `itch_target` input;
   tag-triggered releases use `ITCH_GAME`.
4. Enable GitHub Actions and allow the runner platforms used by the workflow.

After the first upload, edit the game page on itch.io: set **Kind of project**
to HTML and mark the `html5` upload as **This file will be played in the
browser**. The initial Butler upload alone does not set that option. Confirm
that the Windows, macOS and Linux uploads have the correct platform tags.

## Run a release

Merge the release workflow to the default branch. In **Actions → Build and
release → Run workflow**, select the default branch and enter a stable `X.Y.Z`
version such as `1.0.0`, without a `v` prefix or leading zeros. The workflow
limits each component to 65535 for Windows version metadata. The workflow
also runs when a `vX.Y.Z` tag is pushed for a commit reachable from the default
branch; for example `git tag v1.0.0` followed by `git push origin v1.0.0`.
A tag release obtains its destination from `ITCH_GAME`.

Pull requests run the same tests and builds using version `0.0.0`, without
accessing itch.io or publishing. Release runs test and build before the publish
job; any failed build prevents all uploads. Each run retains downloadable ZIP
and tar archives in GitHub Actions artifacts for 14 days:

- Browser HTML5, with `index.html` at the archive root.
- Windows x64 desktop ZIP.
- macOS universal desktop ZIP (Intel and Apple Silicon).
- Linux x64 desktop ZIP.

The tar archives preserve executable permissions and application bundle
symlinks between jobs; the publish job uploads their extracted directories.
The four itch channels are `html5`, `windows`, `osx`, and `linux`, and all
receive the supplied version through Butler's `--userversion` option.

The Windows build is unsigned. The macOS build is ad-hoc signed, but it is not
signed with an Apple Developer ID or notarized. Operating systems may show
security warnings when players first open them. Test on actual target machines
before announcing a release.

Butler publishes channels individually, so itch.io cannot make the four pushes
atomic. The workflow validates all four builds before the first push and stops
on an upload error, but an interruption can leave some channels at the new
version. Check the job log and rerun the same version after fixing the error;
Butler updates each named channel independently.

References: [Butler authentication](https://itch.io/docs/butler/login.html),
[pushing builds and HTML setup](https://itch.io/docs/butler/pushing.html), and
[installing Butler in CI](https://itch.io/docs/butler/installing.html).
