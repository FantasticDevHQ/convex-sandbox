# Source templates and capability limits

Open an owned machine's details and choose **Read source catalog** in Templates
and limits. Rendering the page performs no native catalog request. The server
verifies operator scope, current native ID and binding generation, then uses the
public shared image client for one bounded source catalog page. A binding change
remounts the panel and the shared client rejects stale responses.

The Boat adapter filters saved names to the authorized native source before
projecting entries. Sibling-source names and raw account metadata never reach
the view. The response shows at most 50 matching entries. A partial result stays
explicitly partial; native pagination is unsupported and no cursor is invented.

A saved name is mutable. Saving maps to pending; ready requires a native ready
artifact; failed and unknown remain distinct. Ready does not make the mutable
name an immutable deployment artifact or authorize capture, restore or new
provisioning. A failed refresh marks the previous page as an older observation.

Capability metadata comes from the actual server-side provider declaration. The
panel explains unsupported capture, in-place restore, desktop/SSH and transfer
operations. Those controls stay disabled and request no connection URLs, keys or
mutations. Native access does not enforce the shared expiry/bearer lifetime
contract, and native transfer URLs do not enforce the byte bound. Capability
metadata describes mappings; it is not provider-wide live qualification.

The catalog is read-only and needs server credentials and an existing authorized
binding, but does not require a billable run approval. Credentials stay server
side. Ordinary tests use deterministic synthetic native HTTP and explicitly
labeled browser fixtures. No native provisioning or hosted deployment is implied.
Local worktrees remain isolated and anonymous. Before hosted configuration,
verify the actual FantasticDev team slug/ID, reuse the correct existing project
and verify the selected deployment.
