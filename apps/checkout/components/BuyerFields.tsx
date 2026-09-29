"use client";

import { useCallback, useState } from "react";

import type { CollectedFieldSpec } from "@/lib/types";
import { ConnectField } from "./ConnectField";

/** Controlled state for the buyer's delivery fields. */
export function useBuyerFields(requiredFields: CollectedFieldSpec[], initialValues: Record<string, string>) {
  const [fields, setFields] = useState<Record<string, string>>(() =>
    Object.fromEntries(requiredFields.map((spec) => [spec.key, initialValues[spec.key] ?? ""])),
  );
  const setField = useCallback((key: string, value: string) => {
    setFields((prev) => ({ ...prev, [key]: value }));
  }, []);
  return { fields, setField };
}

interface BuyerFieldsProps {
  idPrefix: string;
  requiredFields: CollectedFieldSpec[];
  fields: Record<string, string>;
  onChange: (key: string, value: string) => void;
  disabled?: boolean;
}

/** Labelled inputs for the delivery details a product needs. */
export function BuyerFields({ idPrefix, requiredFields, fields, onChange, disabled }: BuyerFieldsProps) {
  return (
    <>
      {requiredFields.map((spec) => {
        const id = `${idPrefix}-field-${spec.key}`;
        if (spec.connect) {
          return (
            <ConnectField
              key={spec.key}
              id={id}
              spec={{ ...spec, connect: spec.connect }}
              value={fields[spec.key] ?? ""}
              onChange={(value) => onChange(spec.key, value)}
              {...(disabled !== undefined ? { disabled } : {})}
            />
          );
        }
        return (
          <div className="field" key={spec.key}>
            <label htmlFor={id}>{spec.label}</label>
            <input
              id={id}
              className="input"
              type={spec.inputType}
              inputMode={spec.inputType === "email" ? "email" : "text"}
              value={fields[spec.key] ?? ""}
              placeholder={spec.placeholder}
              autoComplete="off"
              aria-describedby={`${id}-help`}
              disabled={disabled}
              onChange={(event) => onChange(spec.key, event.target.value)}
              required={spec.required}
            />
            <div className="help" id={`${id}-help`}>
              {spec.help}
            </div>
          </div>
        );
      })}
    </>
  );
}
