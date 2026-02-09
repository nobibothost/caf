y;
        }

        const { realActivationDate, realVerificationDate } = calculateLogic(entryDate, finalSubType);
        updateData.activationDate = realActivationDate;
        updateData.verificationDate = realVerificationDate;

        await Customer.findByIdAndUpdate(req.params.id, updateData);
        res.redirect('/manage');
    } catch (err) { res.redirect('/manage'); }
});

app.post('/delete/:id', isAuthenticated, async (req, res) => { 
    try { await Customer.findByIdAndDelete(req.params.id); res.redirect('/manage'); } catch (err) { res.redirect('/manage'); } 
});

app.post('/complete/:id', isAuthenticated, async (req, res) => { 
    try { await Customer.findByIdAndUpdate(req.params.id, { status: 'completed' }); res.redirect('back'); } catch (err) { res.redirect('/'); } 
});

app.get('*', (req, res) => { res.redirect('/'); });

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    const PING_INTERVAL = 5 * 60 * 1000; 
    const TARGET_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
    setInterval(async () => { try { await axios.get(`${TARGET_URL}/health`); console.log(`✅ Pinged ${TARGET_URL}`); } catch (err) { console.error(`❌ Ping Failed`); } }, PING_INTERVAL);
});
