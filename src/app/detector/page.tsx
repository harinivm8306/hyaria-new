"use client";

import { useState } from "react";
import Section from "@/components/Section";
import { Upload, Activity, AlertTriangle, ShieldCheck, Thermometer, Brain, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";

export default function DetectorPage() {
    const [file, setFile] = useState<File | null>(null);
    const [preview, setPreview] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const selected = e.target.files[0];
            setFile(selected);
            setPreview(URL.createObjectURL(selected));
            setResult(null);
            setError(null);
        }
    };

    const handleUpload = async () => {
        if (!file) return;
        setLoading(true);
        setError(null);

        const formData = new FormData();
        formData.append("file", file);

        try {
            const res = await fetch("http://127.0.0.1:8000/detect-disease", {
                method: "POST",
                body: formData,
            });

            if (!res.ok) {
                throw new Error("Failed to analyze image. Ensure the backend is running.");
            }

            const data = await res.json();
            setResult(data);
        } catch (err: any) {
            setError(err.message || "An error occurred");
        } finally {
            setLoading(false);
        }
    };

    return (
        <main className="pt-24 pb-12 min-h-screen transition-all duration-700 bg-background text-foreground">
            <Section>
                <div className="max-w-4xl mx-auto space-y-12">
                    <div className="text-center space-y-4">
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-bold uppercase tracking-wider mb-2">
                            <Brain className="w-4 h-4" />
                            Computer Vision
                        </div>
                        <h1 className="text-5xl md:text-6xl font-black tracking-tight uppercase italic">
                            Disease <span className="text-primary not-italic">Detector</span>
                        </h1>
                        <p className="text-text-muted text-lg max-w-2xl mx-auto">
                            Upload a photo of a plant leaf to instantly identify potential diseases, nutritional deficiencies, and receive automated treatment plans powered by our AI model.
                        </p>
                    </div>

                    <div className="grid md:grid-cols-2 gap-8">
                        {/* Upload Section */}
                        <div className="glass p-8 rounded-[3rem] border border-white/5 flex flex-col items-center justify-center min-h-[400px]">
                            {preview ? (
                                <div className="space-y-6 w-full flex flex-col items-center">
                                    <div className="relative w-full max-w-xs aspect-square rounded-2xl overflow-hidden border-2 border-primary/30 shadow-2xl">
                                        <img src={preview} alt="Preview" className="w-full h-full object-cover" />
                                    </div>
                                    <div className="flex gap-4 w-full">
                                        <button
                                            onClick={() => { setFile(null); setPreview(null); setResult(null); }}
                                            className="flex-1 py-3 px-4 rounded-xl border border-white/10 hover:bg-white/5 font-bold transition-colors"
                                        >
                                            Reset
                                        </button>
                                        <button
                                            onClick={handleUpload}
                                            disabled={loading}
                                            className="flex-1 py-3 px-4 bg-primary hover:bg-primary-dark text-white rounded-xl font-bold transition-all flex justify-center items-center gap-2 shadow-lg shadow-primary/25 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {loading ? "Analyzing..." : "Analyze Image"}
                                            {!loading && <ArrowRight className="w-4 h-4" />}
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <label className="flex flex-col items-center justify-center w-full h-full cursor-pointer group">
                                    <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform group-hover:bg-primary/20">
                                        <Upload className="w-8 h-8 text-primary" />
                                    </div>
                                    <h3 className="text-xl font-bold mb-2">Upload Leaf Image</h3>
                                    <p className="text-sm text-text-muted text-center max-w-xs">
                                        Drag and drop or click to select a clear photo of the affected plant leaf.
                                    </p>
                                    <input type="file" className="hidden" accept="image/*" onChange={handleFileChange} />
                                </label>
                            )}

                            {error && (
                                <div className="mt-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-500 text-sm font-medium w-full text-center">
                                    {error}
                                </div>
                            )}
                        </div>

                        {/* Results Section */}
                        <div className="glass p-8 rounded-[3rem] border border-white/5 flex flex-col">
                            <h3 className="text-2xl font-black uppercase tracking-widest mb-8 opacity-50 flex items-center gap-3">
                                <Activity /> Analysis Report
                            </h3>

                            {loading ? (
                                <div className="flex-1 flex flex-col items-center justify-center space-y-4 opacity-50">
                                    <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
                                    <p className="font-bold tracking-widest uppercase text-sm">Processing via CNN...</p>
                                </div>
                            ) : result ? (
                                <motion.div
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="space-y-6 flex-1 flex flex-col"
                                >
                                    <div className={`p-6 rounded-2xl border flex items-center gap-4 ${result.status === 'Optimal' || result.status === 'Healthy' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
                                        <div className="p-3 bg-white/10 rounded-xl">
                                            {result.status === 'Optimal' || result.status === 'Healthy' ? <ShieldCheck size={32} /> : <AlertTriangle size={32} />}
                                        </div>
                                        <div>
                                            <h4 className="text-xs font-black uppercase tracking-widest mb-1 opacity-70">Status</h4>
                                            <div className="text-2xl font-black">{result.status}</div>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="p-4 bg-foreground/5 rounded-2xl border border-foreground/5">
                                            <span className="text-[10px] font-bold text-text-muted uppercase tracking-widest block mb-1">Plant Type</span>
                                            <span className="font-bold text-lg">{result.plant_detected}</span>
                                        </div>
                                        <div className="p-4 bg-foreground/5 rounded-2xl border border-foreground/5">
                                            <span className="text-[10px] font-bold text-text-muted uppercase tracking-widest block mb-1">Confidence</span>
                                            <span className="font-bold text-lg">{(result.confidence * 100).toFixed(1)}%</span>
                                        </div>
                                    </div>

                                    <div className="p-4 bg-primary/10 rounded-2xl border border-primary/20">
                                        <span className="text-[10px] font-bold text-primary uppercase tracking-widest block mb-1 font-black">Detected Disease</span>
                                        <span className="font-bold text-lg text-foreground">{result.disease}</span>
                                    </div>

                                    <div className="flex-1 p-6 bg-primary/5 border border-primary/20 rounded-2xl mt-4">
                                        <h4 className="text-xs font-black uppercase tracking-widest mb-3 text-primary flex items-center gap-2">
                                            <Thermometer size={14} /> Treatment Plan
                                        </h4>
                                        <p className="text-sm font-medium leading-relaxed text-foreground">
                                            {result.treatment_plan}
                                        </p>
                                    </div>

                                    {result.precision_data && (
                                        <motion.div
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            className="grid grid-cols-3 gap-3"
                                        >
                                            <div className="p-3 bg-foreground/5 rounded-xl border border-foreground/5 text-center">
                                                <span className="text-[9px] font-bold text-text-muted uppercase block">Leaves</span>
                                                <span className="font-bold text-sm text-primary">{result.precision_data.infected_count}/{result.precision_data.total_leaves}</span>
                                            </div>
                                            <div className="p-3 bg-foreground/5 rounded-xl border border-foreground/5 text-center">
                                                <span className="text-[9px] font-bold text-text-muted uppercase block">Severity</span>
                                                <span className="font-bold text-sm text-primary">{result.precision_data.avg_severity_pct}%</span>
                                            </div>
                                            <div className="p-3 bg-foreground/5 rounded-xl border border-foreground/5 text-center">
                                                <span className="text-[9px] font-bold text-text-muted uppercase block">Spray Dose</span>
                                                <span className="font-bold text-sm text-primary">{result.precision_data.dosage_percent}%</span>
                                            </div>
                                        </motion.div>
                                    )}
                                </motion.div>
                            ) : (
                                <div className="flex-1 flex flex-col items-center justify-center opacity-30 text-center">
                                    <Brain size={48} className="mb-4" />
                                    <p className="font-bold">Awaiting image upload...</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </Section>
        </main>
    );
}
