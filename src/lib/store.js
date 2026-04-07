import { create } from 'zustand';
import { supabase } from './supabaseClient';
import { products as initialProducts } from '../data/products';

const CATEGORY_ORDER = [
  "PROMOZIONI",
  "PRODOTTI CHIMICI",
  "ATTREZZATURE",
  "LINEA CARTA",
  "MONOUSO E PLASTICA",
  "SACCHI",
  "DETERGENTI",
  "DISPOSITIVI PROTEZIONE INDIVIDUALE (DPI)",
  "LINEA CORTESIA",
  "ALTRO",
  "NON CATEGORIZZATO"
];

const sackKeywords = ["SACCO","SACCHI","BUSTA","BUSTE","NETTEZZA"];

// Helper to load/save to localStorage
const loadLocalInventory = () => {
    try {
        const saved = localStorage.getItem('raines-inventory-v3'); // FORCE REFRESH V3
        if (saved) return JSON.parse(saved);
    } catch (e) {
        console.error("Error loading local inventory", e);
    }
    // Ensure we always return an array, even if initialProducts is undefined for some reason
    return Array.isArray(initialProducts) ? initialProducts : [];
};

const saveLocalInventory = (inventory) => {
    try {
        localStorage.setItem('raines-inventory-v3', JSON.stringify(inventory));
    } catch (e) {
        console.error("Error saving local inventory", e);
    }
};

const useStore = create((set, get) => ({
    // --- Auth State ---
    user: null,
    isAuthenticated: false,
    authLoading: true,

    // Catalog State - Start with empty, will be filled by fetchCatalog
    inventory: [],
    categories: ['All'],
    loading: false,

    // Catalog Builder State
    catalogItems: [],
    catalogDiscount: 0,
    catalogExpirationDate: null,

    setCatalogMetadata: (metadata) => set((state) => ({
        catalogDiscount: metadata.discount !== undefined ? metadata.discount : state.catalogDiscount,
        catalogExpirationDate: metadata.expirationDate !== undefined ? metadata.expirationDate : state.catalogExpirationDate
    })),

    // --- Catalog Actions ---
    fetchCatalog: async () => {
        try {
            set({ loading: true });
            const { data, error } = await supabase
                .from('catalogo')
                .select('*')
                .order('codice_articolo', { ascending: true });

            if (error) {
                console.error("Error fetching catalog:", error);
            } else if (data) {
                const foundCategories = [...new Set(data.map(p => p.categoria).filter(Boolean))];
                const uniqueCategories = ['All', ...CATEGORY_ORDER.filter(cat => 
                    foundCategories.some(f => f.toUpperCase() === cat.toUpperCase())
                )];
                
                // Add any categories from data that are NOT in CATEGORY_ORDER
                const otherCategories = foundCategories
                    .filter(cat => !CATEGORY_ORDER.some(c => c.toUpperCase() === cat.toUpperCase()))
                    .sort();
                
                const finalCategories = [...uniqueCategories, ...otherCategories];

                // DATA NORMALIZATION: Map catalogo fields to app internal model
                const timestamp = Date.now();
                const normalizedData = data.map(p => ({
                    id: p.codice_articolo,
                    code: p.codice_articolo,
                    _dbId: p.id,
                    name: p.descrizione || '',
                    description: p.specifiche || '',
                    extended_description: p.descrizione_estesa || '',
                    price: parseFloat(p.costo) || 0,
                    category: p.categoria || 'Altro',
                    image: p.link_immagine ? `${p.link_immagine}?v=${timestamp}` : '',
                    image_url: p.link_immagine || '',
                    formato_cartone: p.formato_cartone || '',
                    unita_vendita: p.unita_vendita || '',
                    iva: parseFloat(p.iva) || 0,
                    costo_al_meter: parseFloat(p.costo_al_metro) || 0,
                    immagine_locale: p.immagine_locale || '',
                })).sort((a, b) => {
                    // Category sorting
                    const catA = CATEGORY_ORDER.indexOf(a.category.toUpperCase());
                    const catB = CATEGORY_ORDER.indexOf(b.category.toUpperCase());
                    const orderA = catA === -1 ? 999 : catA;
                    const orderB = catB === -1 ? 999 : catB;
                    
                    if (orderA !== orderB) return orderA - orderB;
                    
                    // Sack prioritization
                    if (a.category.toUpperCase() === 'SACCHI') {
                        const aIsSack = sackKeywords.some(key => 
                            (a.name?.toUpperCase().includes(key) || (a.description || '').toUpperCase().includes(key))
                        );
                        const bIsSack = sackKeywords.some(key => 
                            (b.name?.toUpperCase().includes(key) || (b.description || '').toUpperCase().includes(key))
                        );
                        if (aIsSack && !bIsSack) return -1;
                        if (!aIsSack && bIsSack) return 1;
                    }
                    
                    return (a.name || '').localeCompare(b.name || '');
                });

                set({
                    inventory: normalizedData,
                    categories: finalCategories,
                    loading: false
                });
            }
        } catch (err) {
            console.error("Unexpected error fetching catalog:", err);
            set({ loading: false });
        }
    },

    // --- Catalog Builder Actions ---
    addToCatalog: (product) => set((state) => {
        const newCatalogItems = [...state.catalogItems, { ...product, instanceId: crypto.randomUUID(), quantity: 1 }];
        return { catalogItems: newCatalogItems };
    }),

    removeFromCatalog: (instanceId) => set((state) => {
        const newCatalogItems = state.catalogItems.filter(i => i.instanceId !== instanceId);
        return { catalogItems: newCatalogItems };
    }),

    clearCatalog: () => set({ catalogItems: [] }),

    updateQuantity: (instanceId, delta) => set((state) => {
        const newCatalogItems = state.catalogItems.map(i => {
            if (i.instanceId === instanceId) {
                const newQuantity = Math.max(1, i.quantity + delta);
                return { ...i, quantity: newQuantity };
            }
            return i;
        });
        return { catalogItems: newCatalogItems };
    }),

    setNote: (instanceId, note) => set((state) => {
        const newCatalogItems = state.catalogItems.map(i => {
            if (i.instanceId === instanceId) {
                return { ...i, note: note };
            }
            return i;
        });
        return { catalogItems: newCatalogItems };
    })
}));

export default useStore;
