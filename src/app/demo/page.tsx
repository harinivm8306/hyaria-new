"use client";

import { useState } from "react";
import Section from "@/components/Section";
import { API_BASE } from "@/lib/api";
import { motion, AnimatePresence } from "framer-motion";
import {
    Camera, ShieldCheck, AlertCircle, RefreshCcw,
    Brain, Search, Info, Sprout, Leaf, FlaskConical
} from "lucide-react";

type Tab = "disease" | "stage";

const STAGE_ICONS: Record<string, React.ReactNode> = {
    Seedling: <Sprout size={28} />,
    Vegetative: <Leaf size={28} />,
    Mature: <FlaskConical size={28} />,
};

const STAGE_EMOJIS: Record<string, string> = {
    Seedling: "🌱",
    Vegetative: "🌿",
    Mature: "🥬",
};

export default function DemoPage() {
    const [tab, setTab] = useState<Tab>("disease");

    // --- Disease State ---
    const [diseaseImage, setDiseaseImage] = useState<string | null>(null);
    const [diseaseResult, setDiseaseResult] = useState<any>(null);
    const [diseaseLoading, setDiseaseLoading] = useState(false);

    // --- Stage State ---
    const [stageImage, setStageImage] = useState<string | null>(null);
    const [stageResult, setStageResult] = useState<any>(null);
    const [stageLoading, setStageLoading] = useState(false);

    const handleDiseaseUpload = (e: any) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onloadend = () => { setDiseaseImage(reader.result as string); setDiseaseResult(null); };
        reader.readAsDataURL(file);
    };

    const handleStageUpload = (e: any) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onloadend = () => { setStageImage(reader.result as string); setStageResult(null); };
        reader.readAsDataURL(file);
    };

    const runDiseaseDetection = async () => {
        if (!diseaseImage) return;
        setDiseaseLoading(true);
        try {
            const formData = new FormData();
            const blob = await (await fetch(diseaseImage)).blob();
            formData.append("file", blob, "leaf.jpg");
            const res = await fetch(`${API_BASE}/detect-disease`, { method: "POST", body: formData });
            setDiseaseResult(await res.json());
        } catch (err) { console.error(err); }
        finally { setDiseaseLoading(false); }
    };

    const runStageDetection = async () => {
        if (!stageImage) return;
        setStageLoading(true);
        try {
            const formData = new FormData();
            const blob = await (await fetch(stageImage)).blob();
            formData.append("file", blob, "plant.jpg");
            const res = await fetch(`${API_BASE}/predict-stage`, { method: "POST", body: formData });
            setStageResult(await res.json());
        } catch (err) { console.error(err); }
        finally { setStageLoading(false); }
    };

    return (
        <main className="pt-24 pb-12 min-h-screen">
            <Section>
                <div className="max-w-4xl mx-auto">
                    {/* Header */}
                    <div className="text-center mb-12">
                        <span className="text-primary font-bold tracking-[0.3em] uppercase text-xs">HY-ARIA AI Vision</span>
                        <h1 className="text-5xl font-black mt-4 mb-4">
                            Plant <span className="text-primary">AI</span> Demo
                        </h1>
                        <p className="text-text-muted text-lg">
                            Upload a plant photo to detect diseases or identify its growth stage using computer vision.
                        </p>
                    </div>

                    {/* Tabs */}
                    <div className="flex gap-2 p-1.5 glass rounded-2xl border border-white/10 mb-10 w-fit mx-auto">
                        <button
                            onClick={() => setTab("disease")}
                            className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm transition-all ${tab === "disease" ? "bg-primary text-white" : "text-text-muted hover:text-white"}`}
                        >
                            <ShieldCheck size={16} /> Disease Detection
                        </button>
                        <button
                            onClick={() => setTab("stage")}
                            className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm transition-all ${tab === "stage" ? "bg-primary text-white" : "text-text-muted hover:text-white"}`}
                        >
                            <Sprout size={16} /> Stage Detection
                        </button>
                    </div>

                    <AnimatePresence mode="wait">
                        {/* ====== DISEASE TAB ====== */}
                        {tab === "disease" && (
                            <motion.div
                                key="disease"
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                transition={{ duration: 0.25 }}
                                className="grid md:grid-cols-2 gap-12"
                            >
                                {/* Upload */}
                                <div className="space-y-6">
                                    <div className={`aspect-square glass rounded-[2.5rem] border-2 border-dashed border-white/10 flex flex-col items-center justify-center relative overflow-hidden transition-all ${diseaseImage ? "border-primary/50" : "hover:border-primary/30"}`}>
                                        {diseaseImage ? (
                                            <img src={diseaseImage} className="w-full h-full object-cover" alt="Preview" />
                                        ) : (
                                            <label className="cursor-pointer flex flex-col items-center">
                                                <Camera size={48} className="text-text-muted mb-4" />
                                                <span className="text-sm font-bold">Select Leaf Photo</span>
                                                <input type="file" className="hidden" onChange={handleDiseaseUpload} accept="image/*" />
                                            </label>
                                        )}
                                    </div>
                                    <button
                                        onClick={runDiseaseDetection}
                                        disabled={!diseaseImage || diseaseLoading}
                                        className="w-full py-5 bg-primary rounded-2xl font-bold flex items-center justify-center gap-3 hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {diseaseLoading ? <RefreshCcw className="animate-spin" /> : <Brain size={20} />}
                                        {diseaseLoading ? "Analyzing..." : "Scan for Diseases"}
                                    </button>
                                    {diseaseImage && (
                                        <button onClick={() => { setDiseaseImage(null); setDiseaseResult(null); }} className="w-full text-xs text-text-muted hover:text-white transition-colors">
                                            Clear and try another
                                        </button>
                                    )}
                                </div>

                                {/* Result */}
                                <div className="space-y-6">
                                    {!diseaseResult && !diseaseLoading && (
                                        <div className="h-full glass rounded-[2.5rem] border border-white/5 p-8 flex flex-col items-center justify-center text-center">
                                            <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mb-6">
                                                <Search className="text-text-muted" size={32} />
                                            </div>
                                            <h3 className="font-bold text-xl mb-2">Ready to Analyze</h3>
                                            <p className="text-sm text-text-muted">Upload a leaf photo and our AI will check for 38+ common diseases.</p>
                                        </div>
                                    )}
                                    {diseaseLoading && (
                                        <div className="h-full glass rounded-[2.5rem] border border-white/5 p-8 space-y-8">
                                            {[1, 2, 3].map(i => <div key={i} className="h-12 bg-white/5 rounded-2xl animate-pulse" />)}
                                        </div>
                                    )}
                                    {diseaseResult && (
                                        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
                                            className="glass rounded-[2.5rem] border border-white/10 p-8 space-y-6 bg-gradient-to-br from-primary/5 to-transparent">
                                            <div className="flex items-center gap-4">
                                                <div className={`p-3 rounded-2xl ${diseaseResult.status === "Optimal" ? "bg-green-500/20" : "bg-primary/20"}`}>
                                                    {diseaseResult.status === "Optimal" ? <ShieldCheck className="text-green-400" /> : <AlertCircle className="text-primary" />}
                                                </div>
                                                <div>
                                                    <h3 className="font-bold text-2xl">{diseaseResult.disease}</h3>
                                                    <p className="text-xs text-text-muted uppercase tracking-widest font-black">{(diseaseResult.confidence * 100).toFixed(0)}% Confidence</p>
                                                </div>
                                            </div>
                                            <div className="p-4 bg-white/5 rounded-2xl border border-white/5">
                                                <span className="text-[10px] text-primary font-black uppercase tracking-widest block mb-1">Status</span>
                                                <p className="font-bold">{diseaseResult.status}</p>
                                            </div>
                                            <div className="p-6 bg-primary/10 rounded-3xl border border-primary/20">
                                                <span className="text-[10px] text-primary font-black uppercase tracking-widest flex items-center gap-2 mb-2">
                                                    <Info size={12} /> AI Treatment Plan
                                                </span>
                                                <p className="text-sm leading-relaxed font-medium">{diseaseResult.treatment_plan}</p>
                                            </div>
                                            <p className="text-[10px] text-text-muted">Model ID: HY-ARIA-VISION-V1</p>
                                        </motion.div>
                                    )}
                                </div>
                            </motion.div>
                        )}

                        {/* ====== STAGE TAB ====== */}
                        {tab === "stage" && (
                            <motion.div
                                key="stage"
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                transition={{ duration: 0.25 }}
                                className="grid md:grid-cols-2 gap-12"
                            >
                                {/* Upload */}
                                <div className="space-y-6">
                                    <div className={`aspect-square glass rounded-[2.5rem] border-2 border-dashed border-white/10 flex flex-col items-center justify-center relative overflow-hidden transition-all ${stageImage ? "border-green-500/50" : "hover:border-green-500/30"}`}>
                                        {stageImage ? (
                                            <img src={stageImage} className="w-full h-full object-cover" alt="Preview" />
                                        ) : (
                                            <label className="cursor-pointer flex flex-col items-center">
                                                <Sprout size={48} className="text-text-muted mb-4" />
                                                <span className="text-sm font-bold">Select Plant Photo</span>
                                                <span className="text-xs text-text-muted mt-1">Works best with clear plant images</span>
                                                <input type="file" className="hidden" onChange={handleStageUpload} accept="image/*" />
                                            </label>
                                        )}
                                    </div>
                                    <button
                                        onClick={runStageDetection}
                                        disabled={!stageImage || stageLoading}
                                        className="w-full py-5 rounded-2xl font-bold flex items-center justify-center gap-3 hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                        style={{ background: "linear-gradient(135deg, #16a34a, #22c55e)" }}
                                    >
                                        {stageLoading ? <RefreshCcw className="animate-spin" /> : <Sprout size={20} />}
                                        {stageLoading ? "Analyzing Plant..." : "Detect Growth Stage"}
                                    </button>
                                    {stageImage && (
                                        <button onClick={() => { setStageImage(null); setStageResult(null); }} className="w-full text-xs text-text-muted hover:text-white transition-colors">
                                            Clear and try another
                                        </button>
                                    )}
                                </div>

                                {/* Result */}
                                <div className="space-y-6">
                                    {!stageResult && !stageLoading && (
                                        <div className="h-full glass rounded-[2.5rem] border border-white/5 p-8 flex flex-col items-center justify-center text-center">
                                            <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mb-6">
                                                <Sprout className="text-text-muted" size={32} />
                                            </div>
                                            <h3 className="font-bold text-xl mb-2">How It Works</h3>
                                            <p className="text-sm text-text-muted leading-relaxed">
                                                Our AI analyzes green pixel coverage, leaf density, and canopy complexity to classify your plant into one of three growth stages.
                                            </p>
                                            <div className="mt-6 flex gap-3 text-xs font-bold">
                                                <span className="px-3 py-1.5 rounded-full" style={{ background: "#4ade8030", color: "#4ade80" }}>🌱 Seedling</span>
                                                <span className="px-3 py-1.5 rounded-full" style={{ background: "#22c55e30", color: "#22c55e" }}>🌿 Vegetative</span>
                                                <span className="px-3 py-1.5 rounded-full" style={{ background: "#16a34a30", color: "#16a34a" }}>🥬 Mature</span>
                                            </div>
                                        </div>
                                    )}
                                    {stageLoading && (
                                        <div className="h-full glass rounded-[2.5rem] border border-white/5 p-8 space-y-8">
                                            {[1, 2, 3].map(i => <div key={i} className="h-12 bg-white/5 rounded-2xl animate-pulse" />)}
                                        </div>
                                    )}
                                    {stageResult && (
                                        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
                                            className="glass rounded-[2.5rem] border border-white/10 p-8 space-y-6"
                                            style={{ background: `linear-gradient(135deg, ${stageResult.color}10, transparent)` }}
                                        >
                                            {/* Stage Badge */}
                                            <div className="flex items-center gap-4">
                                                <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl"
                                                    style={{ background: `${stageResult.color}25`, color: stageResult.color }}>
                                                    {STAGE_EMOJIS[stageResult.stage] || "🌱"}
                                                </div>
                                                <div>
                                                    <h3 className="font-black text-3xl" style={{ color: stageResult.color }}>
                                                        {stageResult.stage}
                                                    </h3>
                                                    <p className="text-xs text-text-muted font-bold uppercase tracking-widest">
                                                        {stageResult.image_metrics.green_coverage_pct}% canopy cover
                                                    </p>
                                                </div>
                                            </div>

                                            {/* Canopy cover bar (measured, not a model confidence) */}
                                            <div>
                                                <div className="flex justify-between text-xs text-text-muted mb-1.5">
                                                    <span>Canopy cover</span>
                                                    <span className="font-bold" style={{ color: stageResult.color }}>{stageResult.image_metrics.green_coverage_pct}%</span>
                                                </div>
                                                <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                                                    <motion.div
                                                        initial={{ width: 0 }}
                                                        animate={{ width: `${Math.min(100, stageResult.image_metrics.green_coverage_pct)}%` }}
                                                        transition={{ duration: 0.8, ease: "easeOut" }}
                                                        className="h-full rounded-full"
                                                        style={{ background: stageResult.color }}
                                                    />
                                                </div>
                                            </div>

                                            {/* Description */}
                                            <div className="p-4 rounded-2xl border" style={{ background: `${stageResult.color}10`, borderColor: `${stageResult.color}30` }}>
                                                <span className="text-[10px] font-black uppercase tracking-widest block mb-1" style={{ color: stageResult.color }}>Analysis</span>
                                                <p className="text-sm font-medium">{stageResult.description}</p>
                                                <p className="text-xs text-text-muted mt-1">Estimated age: <strong>{stageResult.days_range}</strong></p>
                                            </div>

                                            {/* Metrics */}
                                            <div className="grid grid-cols-3 gap-3">
                                                <div className="p-3 bg-white/5 rounded-2xl text-center border border-white/5">
                                                    <p className="text-xl font-black" style={{ color: stageResult.color }}>{stageResult.image_metrics.green_coverage_pct}%</p>
                                                    <p className="text-[10px] text-text-muted mt-1 font-bold">Green Cover</p>
                                                </div>
                                                <div className="p-3 bg-white/5 rounded-2xl text-center border border-white/5">
                                                    <p className="text-xl font-black" style={{ color: stageResult.color }}>{stageResult.image_metrics.avg_leaf_brightness}</p>
                                                    <p className="text-[10px] text-text-muted mt-1 font-bold">Brightness</p>
                                                </div>
                                                <div className="p-3 bg-white/5 rounded-2xl text-center border border-white/5">
                                                    <p className="text-xl font-black" style={{ color: stageResult.color }}>{stageResult.image_metrics.leaf_texture_complexity}</p>
                                                    <p className="text-[10px] text-text-muted mt-1 font-bold">Complexity</p>
                                                </div>
                                            </div>

                                            <p className="text-[10px] text-text-muted">Method: green-pixel ratio heuristic (calibrated canopy tracking comes in Phase 2)</p>
                                        </motion.div>
                                    )}
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </Section>
        </main>
    );
}
