"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Save, Plus, Trash2, Search, Settings, Box, UserPlus, ShoppingBag, Lock, AlertTriangle } from "lucide-react";
import { withBasePath } from "@/lib/basePath";
import { GAME_ITEM_CATALOG, GAME_NPC_CATALOG } from "@/lib/gameCatalog";

const TABS = [
  { id: "general", label: "General", icon: Settings },
  { id: "npcSpawns", label: "NPC Spawns", icon: UserPlus },
  { id: "boxDrops", label: "Box Drops", icon: Box },
  { id: "npcShop", label: "Shop", icon: ShoppingBag },
  { id: "unlocks", label: "Unlocks", icon: Lock },
];

function timeLabel(date) {
  if (!date) return "-";
  return new Date(date).toLocaleString();
}

function normalizeChance(val) {
  return Math.max(0, Math.min(100, Number(val) || 0));
}

// Weight calculation using inverse of price
function getWeightForItem(itemType) {
  if (itemType === "coins") return 1 / 10; // Treat coins as high drop rate
  const item = GAME_ITEM_CATALOG.find(i => i.id === itemType);
  if (!item || !item.defaultPrice) return 1 / 50; // default weight
  return 1 / item.defaultPrice;
}

function getWeightForNpc(npcId) {
  // Hardcoded some basic weights for NPCs if needed, otherwise equal
  if (npcId === "chest") return 10;
  if (npcId === "gambling") return 1;
  return 5;
}

// Auto-balance logic based on inverse weights
function autoBalance(items, type = "item") {
  if (!items || items.length === 0) return items;
  if (items.length === 1) {
    return [{ ...items[0], chance: 100 }];
  }

  const weights = items.map(item => {
    if (item.locked) return 0; // Don't recalculate locked items
    if (type === "npc") return getWeightForNpc(item.npcId);
    return getWeightForItem(item.itemType);
  });

  const totalLockedChance = items.filter(i => i.locked).reduce((sum, i) => sum + normalizeChance(i.chance), 0);
  const remainingChance = Math.max(0, 100 - totalLockedChance);
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  return items.map((item, i) => {
    if (item.locked) return item;
    if (totalWeight === 0) return { ...item, chance: remainingChance / weights.length };
    const rawChance = (weights[i] / totalWeight) * remainingChance;
    return { ...item, chance: Math.round(rawChance * 10) / 10 };
  });
}

function AssetPicker({ type, onSelect, onClose }) {
  const [search, setSearch] = useState("");
  const catalog = type === "npc" ? GAME_NPC_CATALOG : GAME_ITEM_CATALOG.filter(i => type === "boxDrop" ? i.canBoxDrop : true);
  
  const filtered = catalog.filter(c => c.label.toLowerCase().includes(search.toLowerCase()) || c.id.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="ops-modal-overlay" onClick={onClose}>
      <div className="ops-modal" onClick={e => e.stopPropagation()}>
        <div className="ops-modal-header">
          <h3>Select {type === "npc" ? "NPC" : "Item"}</h3>
          <button onClick={onClose} className="ops-close-btn">&times;</button>
        </div>
        <input 
          type="text" 
          placeholder="Search..." 
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="ops-search-input"
          autoFocus
        />
        <div className="ops-asset-grid">
          {type === "boxDrop" && (
            <div className="ops-asset-card" onClick={() => onSelect({ id: "coins", label: "Coins", image: "/assets/Item/coin.png" })}>
              <img src={withBasePath("/assets/Item/coin.png")} alt="Coins" />
              <span>Coins</span>
            </div>
          )}
          {filtered.map(item => (
            <div key={item.id} className="ops-asset-card" onClick={() => onSelect(item)}>
              <img src={withBasePath(item.image)} alt={item.label} />
              <span>{item.label}</span>
              {item.defaultPrice && <small>Price: {item.defaultPrice}</small>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PercentageAllocator({ items, type, onChange }) {
  const total = items.reduce((sum, item) => sum + normalizeChance(item.chance), 0);
  const isError = Math.abs(total - 100) > 0.1 && items.length > 0;
  const [showPicker, setShowPicker] = useState(false);

  const handleAdd = (asset) => {
    const key = type === "npc" ? "npcId" : "itemType";
    const nameKey = type === "npc" ? "npcName" : "itemName";
    if (items.some(i => i[key] === asset.id)) return setShowPicker(false);
    
    const newItem = { [key]: asset.id, [nameKey]: asset.label, chance: 0 };
    if (type === "shop") newItem.price = asset.defaultPrice || 100;
    if (asset.id === "coins") {
      newItem.coinMin = 20;
      newItem.coinMax = 200;
    }
    
    const newItems = [...items, newItem];
    onChange(autoBalance(newItems, type));
    setShowPicker(false);
  };

  const handleUpdate = (index, field, value) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], [field]: value };
    onChange(newItems);
  };

  const handleRemove = (index) => {
    const newItems = items.filter((_, i) => i !== index);
    onChange(autoBalance(newItems, type));
  };

  const handleAutoBalance = () => {
    onChange(autoBalance(items, type));
  };

  return (
    <div className="ops-allocator">
      <div className="ops-allocator-header">
        <div className="ops-allocator-bar">
          <div className="ops-allocator-fill" style={{ width: `${Math.min(100, total)}%`, background: isError ? "#ff4d4f" : "#4ade80" }} />
          <span style={{ position: "absolute", left: "10px", zIndex: 1, color: "#fff", textShadow: "0 1px 2px #000" }}>
            Total: {Math.round(total * 10) / 10}%
          </span>
        </div>
        <div className="ops-allocator-actions">
          <button type="button" onClick={handleAutoBalance} className="ops-btn secondary">Auto-Balance (Rarity)</button>
          <button type="button" onClick={() => setShowPicker(true)} className="ops-btn primary"><Plus size={16} /> Add</button>
        </div>
      </div>
      
      {isError && <p className="ops-error-text"><AlertTriangle size={14}/> Total chance must equal 100%</p>}

      <div className="ops-allocator-list">
        {items.map((item, index) => {
          const id = item.npcId || item.itemType;
          const label = item.npcName || item.itemName || id;
          return (
            <div key={id} className="ops-allocator-row">
              <div className="ops-allocator-info">
                <strong>{label}</strong>
                <code>{id}</code>
              </div>
              
              {item.itemType === "coins" && (
                <div className="ops-allocator-extras">
                  <label>Min <input type="number" value={item.coinMin || 0} onChange={e => handleUpdate(index, "coinMin", Number(e.target.value))} /></label>
                  <label>Max <input type="number" value={item.coinMax || 0} onChange={e => handleUpdate(index, "coinMax", Number(e.target.value))} /></label>
                </div>
              )}

              {type === "shop" && (
                <div className="ops-allocator-extras">
                  <label>Price <input type="number" value={item.price || 0} onChange={e => handleUpdate(index, "price", Number(e.target.value))} /></label>
                </div>
              )}

              <div className="ops-allocator-chance">
                <input 
                  type="range" 
                  min="0" max="100" step="0.1" 
                  value={item.chance} 
                  onChange={e => handleUpdate(index, "chance", Number(e.target.value))} 
                />
                <input 
                  type="number" 
                  min="0" max="100" step="0.1" 
                  value={item.chance} 
                  onChange={e => handleUpdate(index, "chance", Number(e.target.value))} 
                  className="ops-chance-input"
                />
                <span>%</span>
                <button type="button" onClick={() => handleUpdate(index, "locked", !item.locked)} className="ops-lock-btn">
                  {item.locked ? <Lock size={16} color="#ffb52b" /> : <Lock size={16} color="#666" opacity={0.3} />}
                </button>
                <button type="button" onClick={() => handleRemove(index)} className="ops-remove-btn"><Trash2 size={16} /></button>
              </div>
            </div>
          );
        })}
        {items.length === 0 && <p className="ops-empty-note">No items configured. Add one to start.</p>}
      </div>

      {showPicker && <AssetPicker type={type === "boxDrops" ? "boxDrop" : type} onSelect={handleAdd} onClose={() => setShowPicker(false)} />}
    </div>
  );
}

export default function RoomConfigDashboard() {
  const [levels, setLevels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [activeTab, setActiveTab] = useState("general");
  
  const [draft, setDraft] = useState(null);

  const loadLevels = useCallback(() => {
    setLoading(true);
    fetch(withBasePath("/api/levels"), { cache: "no-store" })
      .then(res => res.json())
      .then(data => {
        if (data.levels) {
          setLevels(data.levels);
          setDraft(data.levels[0]);
        }
      })
      .catch(() => setError("Failed to load levels"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadLevels();
  }, [loadLevels]);

  const handleSelectLevel = (index) => {
    setActiveIndex(index);
    setDraft(levels[index]);
    setActiveTab("general");
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    const newLevels = [...levels];
    newLevels[activeIndex] = draft;
    
    try {
      const res = await fetch(withBasePath("/api/levels"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ levels: newLevels })
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to save");
      
      setLevels(newLevels);
      alert("Saved successfully!");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const updateDraft = (field, value) => {
    setDraft(prev => ({ ...prev, [field]: value }));
  };

  if (loading) return <div className="ops-dashboard-page"><div className="ops-loading">Loading configuration...</div></div>;

  return (
    <main className="ops-dashboard-page admin-config-page">
      <aside className="ops-sidebar">
        <div className="ops-brand">
          <Settings size={34} />
          <div>
            <strong>Room Config</strong>
            <span>Dashboard</span>
          </div>
        </div>
        <nav aria-label="Levels list">
          {levels.map((level, i) => (
            <button 
              key={level.stageId || i} 
              className={`ops-nav-btn ${i === activeIndex ? "active" : ""}`}
              onClick={() => handleSelectLevel(i)}
            >
              {level.name || level.stageId}
            </button>
          ))}
        </nav>
      </aside>

      <section className="ops-main">
        <header className="ops-header">
          <div>
            <h1>{draft?.name || "Edit Room"}</h1>
            <p>Configure spawns, drops, and unlocks for <code>{draft?.stageId}</code></p>
          </div>
          <div className="ops-header-actions">
            {error && <span className="ops-error-text">{error}</span>}
            <button type="button" onClick={handleSave} disabled={saving} className="ops-btn primary">
              <Save size={18} />
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </header>

        <div className="ops-tabs">
          {TABS.map(tab => (
            <button 
              key={tab.id} 
              className={`ops-tab ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <tab.icon size={16} />
              {tab.label}
            </button>
          ))}
        </div>

        <div className="ops-tab-content">
          {activeTab === "general" && (
            <div className="ops-form-grid">
              <label>
                Stage ID
                <input type="text" value={draft?.stageId || ""} onChange={e => updateDraft("stageId", e.target.value)} disabled />
              </label>
              <label>
                Room Name
                <input type="text" value={draft?.name || ""} onChange={e => updateDraft("name", e.target.value)} />
              </label>
              <label>
                Challenge Title
                <input type="text" value={draft?.challengeInfo?.title || ""} onChange={e => updateDraft("challengeInfo", { ...draft.challengeInfo, title: e.target.value })} />
              </label>
              <label>
                Challenge Video URL
                <input type="text" value={draft?.challengeInfo?.videoUrl || ""} onChange={e => updateDraft("challengeInfo", { ...draft.challengeInfo, videoUrl: e.target.value })} />
              </label>
              <label className="full-width">
                Challenge Description
                <textarea rows={4} value={draft?.challengeInfo?.description || ""} onChange={e => updateDraft("challengeInfo", { ...draft.challengeInfo, description: e.target.value })} />
              </label>
            </div>
          )}

          {activeTab === "npcSpawns" && (
            <PercentageAllocator 
              items={draft?.npcSpawns || []} 
              type="npc" 
              onChange={val => updateDraft("npcSpawns", val)} 
            />
          )}

          {activeTab === "boxDrops" && (
            <PercentageAllocator 
              items={draft?.boxDrops || []} 
              type="boxDrops" 
              onChange={val => updateDraft("boxDrops", val)} 
            />
          )}

          {activeTab === "npcShop" && (
            <PercentageAllocator 
              items={draft?.npcShop || []} 
              type="shop" 
              onChange={val => updateDraft("npcShop", val)} 
            />
          )}

          {activeTab === "unlocks" && (
            <div className="ops-form-grid">
              <p>Unlocks configuration is complex and JSON-based. For now, it is read-only in the UI. Please configure items in Shop and Box Drops.</p>
              <pre className="ops-json-viewer">{JSON.stringify(draft?.unlocks, null, 2)}</pre>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
