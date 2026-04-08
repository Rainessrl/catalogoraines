import { create } from 'zustand';
import { supabase, SUPABASE_URL } from './supabaseClient';
import { products as initialProducts } from '../data/products';

// Resolve image URL: converts relative paths to full Supabase Storage URLs
const STORAGE_BASE = `${SUPABASE_URL}/storage/v1/object/public/catalog`;
const resolveImageUrl = (linkImmagine, immagineLocale) => {
    if (!linkImmagine && !immagineLocale) return '';
    
    const link = linkImmagine || '';
    
    // If it's already a full URL (uploaded via catalog app), use as-is
    if (link.startsWith('http')) return link;
    
    // If it's a relative path like /images/A1206.svg, resolve to Supabase bucket
    if (link.startsWith('/images/')) {
        const fileName = link.replace('/images/', '');
        return `${STORAGE_BASE}/raines_images_cleaned/${fileName}`;
    }
    
    // Fallback: try immagine_locale field
    if (immagineLocale) {
        return `${STORAGE_BASE}/raines_images_cleaned/${immagineLocale}`;
    }
    
    // Last resort: return the raw value
    return link;
};

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

    // Catalog State
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
                
                const otherCategories = foundCategories
                    .filter(cat => !CATEGORY_ORDER.some(c => c.toUpperCase() === cat.toUpperCase()))
                    .sort();
                
                const finalCategories = [...uniqueCategories, ...otherCategories];

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
                    image: (() => { const resolved = resolveImageUrl(p.link_immagine, p.immagine_locale); return resolved ? `${resolved}?v=${timestamp}` : ''; })(),
                    image_url: resolveImageUrl(p.link_immagine, p.immagine_locale),
                    formato_cartone: p.formato_cartone || '',
                    unita_vendita: p.unita_vendita || '',
                    iva: parseFloat(p.iva) || 0,
                    costo_al_metro: parseFloat(p.costo_al_metro) || 0,
                    immagine_locale: p.immagine_locale || '',
                })).sort((a, b) => {
                    const catA = CATEGORY_ORDER.indexOf(a.category.toUpperCase());
                    const catB = CATEGORY_ORDER.indexOf(b.category.toUpperCase());
                    const orderA = catA === -1 ? 999 : catA;
                    const orderB = catB === -1 ? 999 : catB;
                    
                    if (orderA !== orderB) return orderA - orderB;
                    
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

    clearCatalog: () => set({ catalogItems: [], catalogDiscount: 0, catalogExpirationDate: null }),

    setCatalogItems: (items) => {
        const validatedItems = items.map(i => ({ ...i, quantity: i.quantity || 1 }));
        set({ catalogItems: validatedItems });
    },

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
    }),

    // --- Product CRUD Actions ---
    addProduct: async (newProduct) => {
        const payload = {
            codice_articolo: newProduct.id,
            descrizione: newProduct.name || '',
            specifiche: newProduct.description || '',
            descrizione_estesa: newProduct.extended_description || '',
            costo: parseFloat(newProduct.price) || 0,
            categoria: newProduct.category || 'Altro',
            link_immagine: newProduct.image_url || '',
            formato_cartone: newProduct.formato_cartone || '',
            unita_vendita: newProduct.unita_vendita || '',
            iva: parseFloat(newProduct.iva) || 0,
            costo_al_metro: parseFloat(newProduct.costo_al_metro) || 0,
        };

        const { data, error } = await supabase
            .from('catalogo')
            .insert([payload])
            .select();

        if (error) {
            console.error("Error adding product:", error);
            throw error;
        }

        if (data) {
            set((state) => {
                const p = data[0];
                const normalizedItem = {
                    id: p.codice_articolo,
                    _dbId: p.id,
                    name: p.descrizione || '',
                    description: p.specifiche || '',
                    extended_description: p.descrizione_estesa || '',
                    price: parseFloat(p.costo) || 0,
                    category: p.categoria || 'Altro',
                    image: p.link_immagine || '',
                    image_url: p.link_immagine || '',
                };
                return {
                    inventory: [...state.inventory, normalizedItem]
                };
            });
        }
    },

    updateProduct: async (updatedProduct) => {
        const payload = {
            descrizione: updatedProduct.name || '',
            specifiche: updatedProduct.description || '',
            descrizione_estesa: updatedProduct.extended_description || '',
            costo: parseFloat(updatedProduct.price) || 0,
            categoria: updatedProduct.category || 'Altro',
            link_immagine: updatedProduct.image_url || '',
            updated_at: new Date().toISOString(),
        };
        if (updatedProduct.formato_cartone !== undefined) payload.formato_cartone = updatedProduct.formato_cartone;
        if (updatedProduct.unita_vendita !== undefined) payload.unita_vendita = updatedProduct.unita_vendita;
        if (updatedProduct.iva !== undefined) payload.iva = parseFloat(updatedProduct.iva) || 0;
        if (updatedProduct.costo_al_metro !== undefined) payload.costo_al_metro = parseFloat(updatedProduct.costo_al_metro) || 0;

        const { data, error } = await supabase
            .from('catalogo')
            .update(payload)
            .eq('codice_articolo', updatedProduct.id)
            .select();

        if (error) {
            console.error("Error updating product:", error);
            throw error;
        }

        if (data && data.length > 0) {
            const p = data[0];
            set((state) => ({
                inventory: state.inventory.map((item) =>
                    item.id === updatedProduct.id ? {
                        ...item,
                        name: p.descrizione || '',
                        description: p.specifiche || '',
                        extended_description: p.descrizione_estesa || '',
                        price: parseFloat(p.costo) || 0,
                        category: p.categoria || 'Altro',
                        image: p.link_immagine || '',
                        image_url: p.link_immagine || '',
                    } : item
                )
            }));
        }
    },

    deleteProduct: async (id) => {
        const { error } = await supabase
            .from('catalogo')
            .delete()
            .eq('codice_articolo', id);

        if (error) {
            console.error("Error deleting product:", error);
            throw error;
        }

        set((state) => ({
            inventory: state.inventory.filter((item) => item.id !== id)
        }));
    },

    toggleAdminMode: () => set((state) => ({ isAdminMode: !state.isAdminMode })),

    // --- Auth Actions ---
    checkUser: async () => {
        const state = get();
        if (state.user && !state.authLoading) return;

        try {
            const { data: { session } } = await supabase.auth.getSession();
            set({
                user: session?.user || null,
                isAuthenticated: !!session?.user,
                authLoading: false,
            });
        } catch (err) {
            console.error('Error checking user session:', err);
            set({ user: null, isAuthenticated: false, authLoading: false });
        }

        if (!window._authListenerAttached) {
            supabase.auth.onAuthStateChange((_event, session) => {
                set({
                    user: session?.user || null,
                    isAuthenticated: !!session?.user,
                });
            });
            window._authListenerAttached = true;
        }
    },

    signIn: async (email, password) => {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        set({ user: data.user, isAuthenticated: true });
        return data;
    },

    signUp: async (email, password) => {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        return data;
    },

    signOut: async () => {
        await supabase.auth.signOut();
        set({ user: null, isAuthenticated: false, myKits: [] });
    },

    // --- Database Actions ---
    saveCatalogToSupabase: async (info) => {
        const state = get();
        if (!state.user) throw new Error("Devi effettuare il login per salvare.");

        const catalogData = {
            user_id: state.user.id,
            name: info.name || `Catalogo ${new Date().toLocaleDateString()}`,
            items: state.catalogItems,
            total_price: 0
        };

        const { data, error } = await supabase
            .from('medical_kits')
            .insert([catalogData])
            .select();

        if (error) throw error;
        return data[0];
    },

    fetchMyKits: async () => {
        const state = get();
        if (!state.user) return;

        const { data, error } = await supabase
            .from('medical_kits')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            console.error("Error fetching kits:", error);
        } else {
            set({ myKits: data });
        }
    },

    loadFromEncoded: (encoded) => {
        try {
            const decoded = atob(encoded);
            const ids = JSON.parse(decoded);
            const state = get();

            const newItems = ids.map(id => {
                const product = state.inventory.find(p => p.id === id);
                return product ? { ...product, instanceId: crypto.randomUUID() } : null;
            }).filter(Boolean);

            set({ catalogItems: newItems });
        } catch (e) {
            console.error("Errore loading shared catalog", e);
        }
    },

    getShareLink: () => {
        const state = get();
        const itemIds = state.catalogItems.map(item => item.id);
        const data = JSON.stringify(itemIds);
        const encoded = btoa(data);
        const url = new URL(window.location.href);
        url.searchParams.set('k', encoded);
        return url.toString();
    },

    // --- Saved Kits (Quotes) Actions ---
    savedKits: [],

    fetchSavedKits: async () => {
        try {
            const { data, error } = await supabase
                .from('saved_kits')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;

            const currentInventory = get().inventory;
            const resolveImages = (items) => (items || []).map(item => {
                const fresh = currentInventory.find(p => p.id === item.id);
                return fresh ? { ...item, image: fresh.image, image_url: fresh.image_url } : item;
            });

            const normalizedKits = (data || []).map(kit => ({
                id: kit.id,
                name: kit.name,
                items: resolveImages(kit.items),
                totalPrice: parseFloat(kit.total_price) || 0,
                discount: parseFloat(kit.discount) || 0,
                expirationDate: kit.expiration_date,
                createdAt: kit.created_at,
                updatedAt: kit.updated_at
            }));

            set({ savedKits: normalizedKits });
        } catch (error) {
            console.error('Error fetching saved kits:', error);
        }
    },

    saveLocalCatalog: async (catalogDetails) => {
        const state = get();
        const isUpdate = !!catalogDetails.id && !!catalogDetails.items;

        const catalogData = {
            name: catalogDetails.name,
            items: isUpdate ? catalogDetails.items : state.catalogItems,
            total_price: 0,
            discount: catalogDetails.discount !== undefined ? catalogDetails.discount : 0,
            expiration_date: catalogDetails.expirationDate || null,
            updated_at: new Date().toISOString()
        };

        try {
            if (isUpdate && catalogDetails.id) {
                const { error } = await supabase
                    .from('saved_kits')
                    .update(catalogData)
                    .eq('id', catalogDetails.id);
                if (error) throw error;
            } else {
                const { error } = await supabase
                    .from('saved_kits')
                    .insert([catalogData]);
                if (error) throw error;
            }

            await get().fetchSavedKits();
        } catch (error) {
            console.error('Error saving catalog:', error);
            alert('Errore durante il salvataggio del catalogo: ' + error.message);
        }
    },

    deleteLocalCatalog: async (id) => {
        try {
            const { error } = await supabase
                .from('saved_kits')
                .delete()
                .eq('id', id);
            if (error) throw error;
            await get().fetchSavedKits();
        } catch (error) {
            console.error('Error deleting catalog:', error);
            alert("Errore durante l'eliminazione del catalogo: " + error.message);
        }
    },

    loadLocalCatalog: (catalog) => {
        const currentInventory = get().inventory;
        const resolvedItems = (catalog.items || []).map(item => {
            const fresh = currentInventory.find(p => p.id === item.id);
            return fresh ? { ...item, image: fresh.image, image_url: fresh.image_url, price: fresh.price } : item;
        });
        set({
            catalogItems: resolvedItems,
            catalogDiscount: catalog.discount || 0,
            catalogExpirationDate: catalog.expirationDate || null
        });
    },

    // --- Promotions Engine ---
    promotions: [],

    loadPromotions: () => {
        try {
            const saved = localStorage.getItem('raines-promotions-v1');
            if (saved) {
                set({ promotions: JSON.parse(saved) });
            }
        } catch (e) {
            console.error("Error loading promotions", e);
        }
    },

    _savePromotionsToStorage: (promos) => {
        try {
            localStorage.setItem('raines-promotions-v1', JSON.stringify(promos));
        } catch (e) {
            console.error("Error saving promotions", e);
        }
    },

    savePromotion: (promo) => {
        set((state) => {
            const existing = state.promotions.find(p => p.id === promo.id);
            let updated;
            if (existing) {
                updated = state.promotions.map(p => p.id === promo.id ? { ...p, ...promo, updatedAt: new Date().toISOString() } : p);
            } else {
                const newPromo = {
                    ...promo,
                    id: promo.id || crypto.randomUUID(),
                    active: promo.active !== undefined ? promo.active : true,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                };
                updated = [...state.promotions, newPromo];
            }
            get()._savePromotionsToStorage(updated);
            return { promotions: updated };
        });
    },

    deletePromotion: (id) => {
        set((state) => {
            const updated = state.promotions.filter(p => p.id !== id);
            get()._savePromotionsToStorage(updated);
            return { promotions: updated };
        });
    },

    togglePromotion: (id) => {
        set((state) => {
            const updated = state.promotions.map(p =>
                p.id === id ? { ...p, active: !p.active, updatedAt: new Date().toISOString() } : p
            );
            get()._savePromotionsToStorage(updated);
            return { promotions: updated };
        });
    },

    getActivePromotions: () => {
        const state = get();
        const now = new Date().toISOString().slice(0, 10);
        return state.promotions.filter(p => {
            if (!p.active) return false;
            if (p.validFrom && now < p.validFrom) return false;
            if (p.validTo && now > p.validTo) return false;
            return true;
        });
    },

    loading: false,
    myKits: [],
    isAdminMode: true,
    currentView: 'kit',

    setView: (view) => set({ currentView: view }),
}));

export default useStore;
