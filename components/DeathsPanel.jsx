"use client";
import { useEffect, useState, useCallback } from "react";
import { useTranslation, Trans } from "react-i18next";
import { api, Icon, toast } from "@/components/ui";
import PalNameMap from "@/components/PalNameMap";

// Friendly phrasing for an EPalDeadType cause (mirrors lib/supervisor causeText).
const CAUSE_TEXT = {
  Attack: "a Pal", Falling: "falling", Drown: "drowning", Burn: "burning",
  Poison: "poison", BodyTemperature: "the cold", Ground: "the ground",
  SelfDestruction: "self-destruction", Sucide: "themselves",
  TowerBossBattle: "a boss battle", Undefined: "unknown causes",
};
const causeText = (c) => CAUSE_TEXT[c] || (c ? String(c).toLowerCase() : "unknown causes");

export default function DeathsPanel({ worldId, running, onGoToUe4ss, onGoToDiscord }) {
  const { t } = useTranslation();
  const [data, setData] = useState(null); // { deaths, counts, modInstalled, ue4ssInstalled, bundledAvailable }
  const [installing, setInstalling] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [showMap, setShowMap] = useState(false);

  const load = useCallback(() => {
    api(`/api/worlds/${worldId}/deaths`).then(setData).catch(() => {});
  }, [worldId]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 5000); // refresh the feed while the tab is open
    return () => clearInterval(iv);
  }, [load]);

  const installMod = async () => {
    setInstalling(true);
    try {
      const r = await api(`/api/worlds/${worldId}/deaths`, { method: "POST" });
      toast(r.ue4ssDetected ? t("deaths.installedRestart") : t("deaths.copiedNoUe4ss"),
        r.ue4ssDetected ? "success" : "error");
      load();
    } catch (e) { toast(e.message, "error"); }
    finally { setInstalling(false); }
  };

  const removeMod = async () => {
    if (!confirm(t("deaths.confirmRemove"))) return;
    setRemoving(true);
    try {
      await api(`/api/worlds/${worldId}/deaths`, { method: "DELETE" });
      toast(t("deaths.removedRestart"), "success");
      load();
    } catch (e) { toast(e.message, "error"); }
    finally { setRemoving(false); }
  };

  const fmtTime = (ts) => new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  const Name = ({ children }) => <b style={{ color: "var(--accent)", fontWeight: 800 }}>{children}</b>;

  const renderDeath = (d) => {
    if (d.killer_kind === "player" && d.killer) {
      return <Trans i18nKey="deaths.byPlayer" values={{ victim: d.victim, killer: d.killer }}
        components={{ v: <Name />, k: <Name /> }} />;
    }
    if (d.killer) {
      return <Trans i18nKey="deaths.byPal" values={{ victim: d.victim, pal: d.killer }}
        components={{ v: <Name />, k: <Name /> }} />;
    }
    return <Trans i18nKey="deaths.byEnv" values={{ victim: d.victim, cause: causeText(d.cause) }}
      components={{ v: <Name /> }} />;
  };

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      {/* Step 1: UE4SS missing */}
      {data && !data.ue4ssInstalled && (
        <div className="panel-inset" style={{ padding: "0.8rem 1rem", borderLeft: "3px solid var(--yellow)" }}>
          <div style={{ fontWeight: 800, fontSize: "0.9rem", marginBottom: 4 }}>{t("deaths.needsUe4ssTitle")}</div>
          <p className="subtle" style={{ fontWeight: 600, fontSize: "0.78rem", margin: "0 0 8px" }}>{t("deaths.needsUe4ssDesc")}</p>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button className="btn btn-primary" style={{ padding: "0.35rem 0.7rem" }} onClick={onGoToUe4ss}>
              <Icon name="shield" size={15} /> {t("deaths.installUe4ss")}
            </button>
            <button className="btn btn-ghost" style={{ padding: "0.35rem 0.7rem" }}
              onClick={installMod} disabled={installing || running || !data.bundledAvailable}>
              {installing ? t("deaths.copying") : t("deaths.copyAnyway")}
            </button>
          </div>
          {running && <p className="subtle" style={{ fontWeight: 700, fontSize: "0.74rem", margin: "8px 0 0" }}>{t("deaths.stopToChange")}</p>}
        </div>
      )}

      {/* Step 2: UE4SS present but relay not installed */}
      {data && data.ue4ssInstalled && !data.modInstalled && (
        <div className="panel-inset" style={{ padding: "0.8rem 1rem", borderLeft: "3px solid var(--yellow)" }}>
          <div style={{ fontWeight: 800, fontSize: "0.9rem", marginBottom: 4 }}>{t("deaths.installRelayTitle")}</div>
          <p className="subtle" style={{ fontWeight: 600, fontSize: "0.78rem", margin: "0 0 8px" }}>{t("deaths.installRelayDesc")}</p>
          <button className="btn btn-primary" style={{ padding: "0.35rem 0.7rem" }}
            onClick={installMod} disabled={installing || running || !data.bundledAvailable}>
            <Icon name="download" size={15} /> {installing ? t("deaths.installing") : t("deaths.installRelay")}
          </button>
          {running && <p className="subtle" style={{ fontWeight: 700, fontSize: "0.74rem", margin: "8px 0 0" }}>{t("deaths.stopToInstall")}</p>}
        </div>
      )}

      {/* Installed status + remove */}
      {data && data.modInstalled && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.8rem", flexWrap: "wrap" }}>
          <div className="subtle" style={{ fontWeight: 700, fontSize: "0.74rem", flex: 1, minWidth: 200 }}>
            <span className="s-running">{t("deaths.modInstalled")}</span>{t("deaths.modInstalledRest")}
          </div>
          <button className="btn btn-ghost" style={{ padding: "0.3rem 0.6rem", fontSize: "0.76rem" }} onClick={onGoToDiscord}>
            <Icon name="bell" size={14} /> {t("deaths.configureDiscord")}
          </button>
          <button className="btn btn-danger" style={{ padding: "0.3rem 0.6rem", fontSize: "0.76rem" }}
            onClick={removeMod} disabled={removing || running} title={running ? t("deaths.stopToRemove") : undefined}>
            <Icon name="trash" size={14} /> {removing ? t("deaths.removing") : t("deaths.removeMod")}
          </button>
        </div>
      )}

      {/* Most-deaths leaderboard */}
      {data && data.counts && data.counts.length > 0 && (
        <div>
          <h3 className="heading" style={{ fontSize: "1rem", marginTop: 0, marginBottom: "0.5rem" }}>{t("deaths.leaderboardTitle")}</h3>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {data.counts.slice(0, 12).map((c) => (
              <div key={c.victim} className="panel-inset" style={{ padding: "0.4rem 0.7rem", display: "flex", gap: "0.5rem", alignItems: "baseline" }}>
                <span style={{ fontWeight: 800 }}>{c.victim}</span>
                <span className="subtle" style={{ fontWeight: 700, fontSize: "0.76rem" }}>{t("deaths.deathCount", { count: c.deaths })}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pal name mapping (world-scoped override; inherits global then the built-in default) */}
      <div>
        <button className="btn btn-ghost" style={{ padding: "0.35rem 0.6rem", fontSize: "0.86rem", fontWeight: 800 }}
          onClick={() => setShowMap((v) => !v)}>
          <Icon name={showMap ? "chevronDown" : "chevronRight"} size={16} /> {t("palmap.worldTitle")}
        </button>
        {showMap && (
          <div style={{ marginTop: "0.6rem" }}>
            <p className="subtle" style={{ fontWeight: 600, fontSize: "0.78rem", margin: "0 0 0.8rem" }}>{t("palmap.worldDesc")}</p>
            <PalNameMap scope="world" endpoint={`/api/worlds/${worldId}/palnames`} />
          </div>
        )}
      </div>

      {/* Death feed */}
      <div>
        <h3 className="heading" style={{ fontSize: "1rem", marginTop: 0, marginBottom: "0.5rem" }}>{t("deaths.feedTitle")}</h3>
        <div className="panel-inset" style={{ padding: "0.6rem 0.8rem", maxHeight: 460, overflowY: "auto" }}>
          {!data || data.deaths.length === 0 ? (
            <div className="subtle" style={{ fontWeight: 600, textAlign: "center", padding: "1.5rem 0" }}>
              {t("deaths.empty")}
              {data && !data.modInstalled && <div style={{ marginTop: 6 }}>{t("deaths.emptyNeedsMod")}</div>}
            </div>
          ) : (
            data.deaths.map((d) => (
              <div key={d.id} style={{ display: "flex", gap: "0.6rem", padding: "0.3rem 0", alignItems: "baseline" }}>
                <span className="subtle" style={{ fontSize: "0.68rem", fontWeight: 600, minWidth: 92 }}>{fmtTime(d.created_at)}</span>
                <span style={{ fontWeight: 500, wordBreak: "break-word" }}>{renderDeath(d)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
