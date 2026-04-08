import React, { useState, useEffect, useRef } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    TextField,
    Grid,
    MenuItem,
    Typography,
    Box,
    IconButton,
    Avatar,
    CircularProgress,
    Tooltip,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import DeleteIcon from '@mui/icons-material/Delete';
import useStore from '../lib/store';
import { supabase } from '../lib/supabaseClient';

import { processProductImage } from '../lib/imageProcessor';

export const ProductEditor = () => {
    const [open, setOpen] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [loading, setLoading] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState('');
    const [previewUrl, setPreviewUrl] = useState('');
    const fileInputRef = useRef(null);

    const [formData, setFormData] = useState({
        id: '', 
        name: '',
        description: '',
        extended_description: '',
        price: '',
        category: 'Altro',
        image_url: '',
        iva: '22',
        formato_cartone: '',
        unita_vendita: 'PZ',
        costo_al_metro: ''
    });

    const categories = useStore((state) => state.categories);

    useEffect(() => {
        const handleNew = () => {
            setFormData({ 
                id: '', name: '', description: '', extended_description: '', 
                price: '', category: 'Altro', image_url: '', 
                iva: '22', formato_cartone: '', unita_vendita: 'PZ', costo_al_metro: '' 
            });
            setPreviewUrl('');
            setUploadProgress('');
            setIsEditing(false);
            setOpen(true);
        };
        const handleEdit = (e) => {
            const item = e.detail;
            const data = {
                id: item.id || item.code || '',
                name: item.name || '',
                description: item.description || '',
                extended_description: item.extended_description || '',
                price: item.price || '',
                category: item.category || 'Altro',
                image_url: item.image_url || item.image || '',
                iva: item.iva || '22',
                formato_cartone: item.formato_cartone || '',
                unita_vendita: item.unita_vendita || 'PZ',
                costo_al_metro: item.costo_al_metro || ''
            };
            setFormData(data);
            setPreviewUrl(data.image_url);
            setUploadProgress('');
            setIsEditing(true);
            setOpen(true);
        };

        window.addEventListener('new-product', handleNew);
        window.addEventListener('edit-product', handleEdit);
        return () => {
            window.removeEventListener('new-product', handleNew);
            window.removeEventListener('edit-product', handleEdit);
        };
    }, []);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleFileChange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (!formData.id) {
            alert('Per favore, inserisci prima il Codice Articolo per poter elaborare l\'immagine.');
            return;
        }

        setUploading(true);
        setUploadProgress('Inizializzazione...');
        
        try {
            // 1. Processamento Immagine (Scontorno, Resize, SVG) nel browser
            setUploadProgress('Scontorno e ridimensionamento...');
            const { blob, fileName } = await processProductImage(file, formData.id);

            // 2. Upload su Supabase (Bucket: catalog)
            setUploadProgress('Caricamento su database...');
            const filePath = `raines_images_cleaned/${fileName}`;

            const { error: uploadError } = await supabase.storage
                .from('catalog')
                .upload(filePath, blob, {
                    contentType: 'image/svg+xml',
                    upsert: true
                });

            if (uploadError) {
                // Se il bucket 'catalog' non esiste, proviamo a usare 'product-images' come fallback
                console.warn('Bucket catalog non trovato, ripiego su product-images');
                const { error: fallbackError } = await supabase.storage
                    .from('product-images')
                    .upload(`products/${fileName}`, blob, {
                        contentType: 'image/svg+xml',
                        upsert: true
                    });
                
                if (fallbackError) throw fallbackError;

                const { data: publicData } = supabase.storage
                    .from('product-images')
                    .getPublicUrl(`products/${fileName}`);

                setFormData(prev => ({ ...prev, image_url: publicData.publicUrl }));
                setPreviewUrl(publicData.publicUrl);
            } else {
                const { data: publicData } = supabase.storage
                    .from('catalog')
                    .getPublicUrl(filePath);

                setFormData(prev => ({ ...prev, image_url: publicData.publicUrl }));
                setPreviewUrl(publicData.publicUrl);
            }

            setUploadProgress('Completato!');
        } catch (error) {
            console.error('Error processing/uploading image:', error);
            alert('Errore durante l\'elaborazione dell\'immagine: ' + error.message);
            setUploadProgress('Errore');
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleRemoveImage = () => {
        setPreviewUrl('');
        setFormData(prev => ({ ...prev, image_url: '' }));
        setUploadProgress('');
    };

    const handleSave = async () => {
        if (!formData.id || !formData.name) {
            alert('Codice articolo e Nome sono obbligatori.');
            return;
        }

        setLoading(true);
        try {
            const productData = {
                codice_articolo: formData.id,
                descrizione: formData.name,
                specifiche: formData.description,
                descrizione_estesa: formData.extended_description,
                costo: parseFloat(formData.price) || 0,
                categoria: formData.category,
                link_immagine: formData.image_url,
                iva: formData.iva,
                formato_cartone: formData.formato_cartone,
                unita_vendita: formData.unita_vendita,
                costo_al_metro: formData.costo_al_metro ? parseFloat(formData.costo_al_metro) : null,
                updated_at: new Date().toISOString()
            };

            if (isEditing) {
                const { error } = await supabase
                    .from('catalogo')
                    .update(productData)
                    .eq('codice_articolo', formData.id);

                if (error) throw error;
            } else {
                const { data: existing, error: checkError } = await supabase
                    .from('catalogo')
                    .select('codice_articolo')
                    .eq('codice_articolo', formData.id)
                    .maybeSingle();
                
                if (checkError) throw checkError;
                if (existing) {
                    alert(`ATTENZIONE: Il codice articolo "${formData.id}" è già presente nel catalogo!\n\nSe vuoi aggiornare questo prodotto, usa la funzione "Modifica" dalla lista.\nSe vuoi creare un nuovo prodotto, scegli un codice differente.`);
                    setLoading(false);
                    return;
                }

                const { error } = await supabase
                    .from('catalogo')
                    .insert([productData]);

                if (error) throw error;
            }

            await useStore.getState().fetchCatalog();
            setOpen(false);
        } catch (error) {
            console.error('Save error:', error);
            alert('Errore durante il salvataggio: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog 
            open={open} 
            onClose={() => setOpen(false)}
            fullWidth
            maxWidth="md"
        >
            <DialogTitle>
                <Box display="flex" justifyContent="space-between" alignItems="center">
                    <Typography variant="h6">
                        {isEditing ? 'Modifica Prodotto' : 'Nuovo Prodotto'}
                    </Typography>
                    <IconButton onClick={() => setOpen(false)}>
                        <CloseIcon />
                    </IconButton>
                </Box>
            </DialogTitle>
            <DialogContent dividers>
                <Grid container spacing={2}>
                    <Grid item xs={12} sm={4}>
                        <TextField
                            fullWidth
                            label="Codice Articolo"
                            name="id"
                            value={formData.id}
                            onChange={handleChange}
                            disabled={isEditing}
                            required
                        />
                    </Grid>
                    <Grid item xs={12} sm={8}>
                        <TextField
                            fullWidth
                            label="Nome Prodotto"
                            name="name"
                            value={formData.name}
                            onChange={handleChange}
                            required
                        />
                    </Grid>
                    <Grid item xs={12}>
                        <TextField
                            fullWidth
                            label="Descrizione Breve (Specifiche)"
                            name="description"
                            value={formData.description}
                            onChange={handleChange}
                            multiline
                            rows={2}
                        />
                    </Grid>
                    <Grid item xs={12} sm={4}>
                        <TextField
                            fullWidth
                            label="Prezzo (€)"
                            name="price"
                            type="number"
                            value={formData.price}
                            onChange={handleChange}
                        />
                    </Grid>
                    <Grid item xs={12} sm={4}>
                        <TextField
                            fullWidth
                            select
                            label="Categoria"
                            name="category"
                            value={formData.category}
                            onChange={handleChange}
                        >
                            {categories.map((cat) => (
                                <MenuItem key={cat} value={cat}>
                                    {cat}
                                </MenuItem>
                            ))}
                        </TextField>
                    </Grid>
                    <Grid item xs={12} sm={4}>
                        <TextField
                            fullWidth
                            label="IVA (%)"
                            name="iva"
                            value={formData.iva}
                            onChange={handleChange}
                        />
                    </Grid>
                    <Grid item xs={12}>
                        <Typography variant="subtitle2" gutterBottom>
                            Immagine Prodotto
                        </Typography>
                        <Box border="1px dashed #ccc" borderRadius={1} p={2} textAlign="center">
                            {previewUrl ? (
                                <Box position="relative" display="inline-block">
                                    <Avatar
                                        src={previewUrl}
                                        variant="rounded"
                                        sx={{ width: 150, height: 150, border: '1px solid #eee' }}
                                    />
                                    <IconButton
                                        size="small"
                                        onClick={handleRemoveImage}
                                        sx={{
                                            position: 'absolute',
                                            top: -10,
                                            right: -10,
                                            backgroundColor: 'error.main',
                                            color: 'white',
                                            '&:hover': { backgroundColor: 'error.dark' }
                                        }}
                                    >
                                        <DeleteIcon fontSize="small" />
                                    </IconButton>
                                </Box>
                            ) : (
                                <Box
                                    onClick={() => fileInputRef.current?.click()}
                                    sx={{ cursor: 'pointer', py: 3 }}
                                >
                                    <CloudUploadIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
                                    <Typography color="textSecondary">
                                        Clicca per caricare un'immagine
                                    </Typography>
                                    <Typography variant="caption" color="textSecondary">
                                        Verrà automaticamente scontornata e ottimizzata
                                    </Typography>
                                </Box>
                            )}
                            <input
                                type="file"
                                hidden
                                ref={fileInputRef}
                                accept="image/*"
                                onChange={handleFileChange}
                            />
                            {uploading && (
                                <Box mt={2}>
                                    <CircularProgress size={24} sx={{ mb: 1 }} />
                                    <Typography variant="caption" display="block">
                                        {uploadProgress}
                                    </Typography>
                                </Box>
                            )}
                        </Box>
                    </Grid>
                    <Grid item xs={12} sm={4}>
                        <TextField
                            fullWidth
                            label="Formato Cartone"
                            name="formato_cartone"
                            value={formData.formato_cartone}
                            onChange={handleChange}
                        />
                    </Grid>
                    <Grid item xs={12} sm={4}>
                        <TextField
                            fullWidth
                            label="Unità Vendita"
                            name="unita_vendita"
                            value={formData.unita_vendita}
                            onChange={handleChange}
                        />
                    </Grid>
                    <Grid item xs={12} sm={4}>
                        <TextField
                            fullWidth
                            label="Costo al Metro"
                            name="costo_al_metro"
                            type="number"
                            value={formData.costo_al_metro}
                            onChange={handleChange}
                        />
                    </Grid>
                    <Grid item xs={12}>
                        <TextField
                            fullWidth
                            label="Descrizione Estesa"
                            name="extended_description"
                            value={formData.extended_description}
                            onChange={handleChange}
                            multiline
                            rows={4}
                        />
                    </Grid>
                </Grid>
            </DialogContent>
            <DialogActions sx={{ p: 2 }}>
                <Button onClick={() => setOpen(false)} color="inherit">
                    Annulla
                </Button>
                <Button
                    onClick={handleSave}
                    variant="contained"
                    disabled={loading || uploading}
                    startIcon={loading ? <CircularProgress size={20} /> : null}
                >
                    {isEditing ? 'Aggiorna' : 'Salva Prodotto'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};
