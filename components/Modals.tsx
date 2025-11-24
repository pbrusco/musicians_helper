
import React, { useState, useEffect } from 'react';

interface ModalProps {
    isOpen: boolean;
    title?: string;
    children: React.ReactNode;
}

const BaseModal: React.FC<ModalProps> = ({ isOpen, title, children }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm">
            <div className="bg-slate-900 border border-slate-700 rounded-lg shadow-2xl p-6 w-full max-w-sm animate-in fade-in zoom-in duration-200">
                {title && <h3 className="text-lg font-bold text-slate-200 mb-4">{title}</h3>}
                {children}
            </div>
        </div>
    );
};

export const ConfirmationModal = ({ isOpen, message, onConfirm, onCancel }: { isOpen: boolean; message: string; onConfirm: () => void; onCancel: () => void }) => {
    return (
        <BaseModal isOpen={isOpen} title="Confirmación">
            <p className="text-slate-400 mb-6 text-sm">{message}</p>
            <div className="flex justify-end gap-3">
                <button onClick={onCancel} className="px-4 py-2 rounded text-slate-300 hover:bg-slate-800 text-sm font-medium">Cancelar</button>
                <button onClick={onConfirm} className="px-4 py-2 rounded bg-red-600 hover:bg-red-500 text-white text-sm font-medium shadow-lg shadow-red-900/20">Confirmar</button>
            </div>
        </BaseModal>
    );
};

export const AlertModal = ({ isOpen, message, onClose }: { isOpen: boolean; message: string; onClose: () => void }) => {
    return (
        <BaseModal isOpen={isOpen} title="Alerta">
             <p className="text-slate-400 mb-6 text-sm">{message}</p>
             <div className="flex justify-end">
                <button onClick={onClose} className="px-4 py-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm border border-slate-700">Entendido</button>
             </div>
        </BaseModal>
    );
};

export const RenameModal = ({ isOpen, title, initialValue, onSave, onCancel }: { isOpen: boolean; title: string; initialValue: string; onSave: (val: string) => void; onCancel: () => void }) => {
    const [value, setValue] = useState(initialValue);
    
    // Reset value when modal opens
    useEffect(() => {
        if (isOpen) setValue(initialValue);
    }, [isOpen, initialValue]);

    return (
        <BaseModal isOpen={isOpen} title={title}>
            <input 
                type="text" 
                value={value} 
                onChange={(e) => setValue(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-slate-200 focus:outline-none focus:border-cyan-500 mb-6"
                autoFocus
                onKeyDown={(e) => {
                    if (e.key === 'Enter') onSave(value);
                    if (e.key === 'Escape') onCancel();
                }}
            />
            <div className="flex justify-end gap-3">
                <button onClick={onCancel} className="px-4 py-2 rounded text-slate-300 hover:bg-slate-800 text-sm font-medium">Cancelar</button>
                <button onClick={() => onSave(value)} className="px-4 py-2 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium shadow-lg shadow-cyan-900/20">Guardar</button>
            </div>
        </BaseModal>
    );
};
