"use client";
import { useEffect, useMemo, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { api, Icon, toast } from "@/components/ui";
import { catalog, displayName, sanitizeOverrides } from "@/lib/palnames";

// Editable, searchable Pal display-name mapping. Renders the same at two scopes:
//   scope="global" -> endpoint /api/palnames        (overrides applied to every world)
//   scope="world"  -> endpoint /api/worlds/:id/palnames
// Resolution priority is world -> global -> built-in default (lib/palnames.resolve); this
// editor edits one layer. Pals seen in-game but not named yet arrive as `unmapped` and are
// pinned to the top so new content can be labelled the moment it shows up.
export default function PalNameMap({ scope = "global", endpoint }) {
  const { t } = useTranslation();
  const [data, setData] = useState(null); // { overrides, globalOverrides?, unmapped }
  const [edits, setEdits] = useState({}); // codename -> override string (being edited)
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api(endpoint).then((r) => { setData(r); setEdits({ ...(r.overrides || {}) }); }).catch(() => {});
  }, [endpoint]);
  useEffect(() => { load(); }, [load]);

  const globalOverrides = data?.globalOverrides || {};

  // Every row the editor can show: built-in catalog + any override-only codenames + any
  // unmapped (seen but unnamed) codenames. Deduped by codename; unmapped flagged `isNew`.
  const rows = useMemo(() => {
    const byCode = new Map();
    for (const p of catalog()) byCode.set(p.codename, { codename: p.codename, kind: p.kind, isNew: false });
    for (const u of data?.unmapped || []) byCode.set(u.codename, { codename: u.codename, kind: u.kind || "pal", isNew: true });
    for (const code of Object.keys(data?.overrides || {})) if (!byCode.has(code)) byCode.set(code, { codename: code, kind: "pal", isNew: false });
    return [...byCode.values()];
  }, [data]);

  // What a blank override falls back to: at world scope the global override (if any) then
  // the built-in default; at global scope just the built-in default.
  const inheritedOf = useCallback(
    (code) => (scope === "world" && globalOverrides[code]) || displayName(code),
    [scope, globalOverrides]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? rows.filter((r) => {
          const eff = (edits[r.codename] || inheritedOf(r.codename)).toLowerCase();
          return r.codename.toLowerCase().includes(q) || eff.includes(q);
        })
      : rows;
    // New (unmapped) first, then alphabetical by effective name.
    return [...list].sort((a, b) => {
      if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
      return (edits[a.codename] || inheritedOf(a.codename)).localeCompare(edits[b.codename] || inheritedOf(b.codename));
    });
  }, [rows, query, edits, inheritedOf]);

  const cleaned = useMemo(() => sanitizeOverrides(edits), [edits]);
  const dirty = useMemo(() => JSON.stringify(cleaned) !== JSON.stringify(data?.overrides || {}), [cleaned, data]);
  const customisedCount = Object.keys(cleaned).length;
  const newCount = (data?.unmapped || []).length;

  const setName = (code, val) => setEdits((e) => ({ ...e, [code]: val }));

  const save = async () => {
    setSaving(true);
    try {
      const r = await api(endpoint, { method: "POST", body: { overrides: cleaned } });
      setData(r); setEdits({ ...(r.overrides || {}) });
      toast(t("palmap.saved"), "success");
    } catch (e) { toast(e.message, "error"); }
    finally { setSaving(false); }
  };

  if (!data) return <p className="subtle" style={{ fontWeight: 700, fontSize: "0.8rem" }}>{t("common.loading")}</p>;

  return (
    <div>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", marginBottom: "0.6rem" }}>
        <input className="input" style={{ flex: 1, minWidth: 200 }} placeholder={t("palmap.search")}
          value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="btn btn-primary" style={{ padding: "0.4rem 0.8rem" }} onClick={save} disabled={saving || !dirty}>
          <Icon name="check" size={15} /> {saving ? t("palmap.saving") : t("common.save")}
        </button>
      </div>
      <p className="subtle" style={{ fontWeight: 700, fontSize: "0.72rem", margin: "0 0 0.6rem" }}>
        {t("palmap.total", { count: rows.length })}
        {customisedCount > 0 ? ` · ${t("palmap.customised", { count: customisedCount })}` : ""}
        {newCount > 0 ? ` · ${t("palmap.newCount", { count: newCount })}` : ""}
      </p>

      <div className="panel-inset" style={{ padding: "0.3rem 0.4rem", maxHeight: 420, overflowY: "auto" }}>
        {filtered.length === 0 ? (
          <p className="subtle" style={{ fontWeight: 600, textAlign: "center", padding: "1.2rem 0" }}>{t("palmap.empty")}</p>
        ) : (
          filtered.map((r) => {
            const val = edits[r.codename] || "";
            return (
              <div key={r.codename} style={{
                display: "flex", gap: "0.5rem", alignItems: "center", padding: "0.28rem 0.35rem",
                borderLeft: r.isNew ? "3px solid var(--yellow)" : "3px solid transparent",
              }}>
                <div style={{ minWidth: 0, flex: "1 1 40%" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.74rem", fontWeight: 700, wordBreak: "break-all" }}>{r.codename}</span>
                    {r.isNew && <span style={{ fontSize: "0.6rem", fontWeight: 800, color: "var(--yellow)", border: "1px solid var(--yellow)", borderRadius: 4, padding: "0 4px" }}>{t("palmap.newBadge")}</span>}
                    {r.kind === "npc" && <span className="subtle" style={{ fontSize: "0.6rem", fontWeight: 800, border: "1px solid var(--border)", borderRadius: 4, padding: "0 4px" }}>{t("palmap.npcBadge")}</span>}
                  </div>
                </div>
                <input className="input" style={{ flex: "1 1 45%", minWidth: 120, padding: "0.28rem 0.5rem", fontSize: "0.82rem" }}
                  value={val} placeholder={inheritedOf(r.codename)}
                  onChange={(e) => setName(r.codename, e.target.value)} />
                <button className="btn btn-ghost" style={{ padding: "0.2rem 0.4rem", visibility: val ? "visible" : "hidden" }}
                  title={t("palmap.clear")} onClick={() => setName(r.codename, "")}>
                  <Icon name="x" size={13} />
                </button>
              </div>
            );
          })
        )}
      </div>
      <p className="subtle" style={{ fontWeight: 600, fontSize: "0.7rem", margin: "0.5rem 0 0" }}>{t("palmap.hint")}</p>
    </div>
  );
}
