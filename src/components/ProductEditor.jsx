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
            // Reset input per permettere re-upload dello stesso file se necessario
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
                // CONTROLLO UNICITA: Verifichiamo se il codice esiste gia
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
            onClose();
        } catch (error) {
            console.error('Save error:', error);
            alert('Errore durante il salvataggio: ' + error.message);
        } finally {
            setLoading(false);
        }
    };


    return (
        <Dialog 
