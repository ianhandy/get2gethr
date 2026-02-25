"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface ParticipantChipsProps {
  emails: string[];
  onChange: (emails: string[]) => void;
}

export default function ParticipantChips({ emails, onChange }: ParticipantChipsProps) {
  const [inputValue, setInputValue] = useState("");
  const [inputError, setInputError] = useState(false);

  function addEmail(raw: string) {
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setInputError(true);
      setTimeout(() => setInputError(false), 600);
      return;
    }
    if (emails.includes(trimmed)) {
      setInputValue("");
      return;
    }
    onChange([...emails, trimmed]);
    setInputValue("");
  }

  function removeEmail(email: string) {
    onChange(emails.filter((e) => e !== email));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === "," || e.key === " ") {
      e.preventDefault();
      addEmail(inputValue);
    } else if (e.key === "Backspace" && inputValue === "" && emails.length > 0) {
      removeEmail(emails[emails.length - 1]);
    }
  }

  return (
    <div
      className="flex min-h-[52px] flex-wrap items-center gap-2 rounded-xl border px-3 py-2 transition-all"
      style={{
        background: "var(--color-surface)",
        borderColor: inputError ? "var(--color-accent-a)" : "var(--color-border)",
      }}
      onClick={(e) => {
        const input = (e.currentTarget as HTMLDivElement).querySelector("input");
        input?.focus();
      }}
    >
      <AnimatePresence mode="popLayout">
        {emails.map((email) => (
          <motion.div
            key={email}
            layout
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0, x: -10 }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
            className="flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium"
            style={{
              background: "color-mix(in srgb, var(--color-accent-c) 15%, transparent)",
              color: "var(--color-primary)",
              border: "1px solid color-mix(in srgb, var(--color-accent-c) 40%, transparent)",
            }}
          >
            {email}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeEmail(email);
              }}
              className="flex h-4 w-4 items-center justify-center rounded-full text-xs transition-colors hover:bg-black/10"
            >
              ×
            </button>
          </motion.div>
        ))}
      </AnimatePresence>

      <input
        type="email"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => addEmail(inputValue)}
        placeholder={emails.length === 0 ? "add@email.com, press Enter…" : "+add more"}
        className="min-w-[160px] flex-1 bg-transparent text-sm outline-none placeholder:text-gray-400"
        style={{ color: "var(--color-primary)" }}
      />

      {inputError && (
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="text-xs"
          style={{ color: "var(--color-accent-a)" }}
        >
          Invalid email
        </motion.span>
      )}
    </div>
  );
}
