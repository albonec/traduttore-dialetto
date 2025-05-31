let italianoWords = [];
let brescianoWords = [];

document.addEventListener('DOMContentLoaded', function() {
    fetch('dict.csv')
        .then(response => response.text())
        .then(data => {
            Papa.parse(data, {
                header: true,
                complete: function(results) {
                    [italianoWords, brescianoWords] = convertCSVToArrays(results.data);
                }
            });
        });
});

function convertCSVToArrays(data) {
    const italiano = [];
    const bresciano = [];

    data.forEach(row => {
        italiano.push(row.Italiano);
        bresciano.push(row.Bresciano);
    });

    return [italiano, bresciano];
}

function translateText() {
    const inputText = document.getElementById('inputText').value;
    const targetLanguage = document.getElementById('targetLanguage').value;

    if (targetLanguage === 'br') {
        const cleanedInputText = inputText.replace(/[^a-zA-Z\s]/g, ''); // Retain only letters and spaces
        const words = cleanedInputText.split(' ');

        const translatedWords = words.map(word => {
            const index = italianoWords.indexOf(word.toLowerCase());
            if (index !== -1) {
                const translation = brescianoWords[index];
                return preserveCapitalization(word, translation);
            }
            return word;
        });

        const translation = translatedWords.join(' ');
        document.getElementById('outputText').innerText = translation;
    }
}

function preserveCapitalization(original, translation) {
    if (!original || !translation) return translation;

    // If the original word is all uppercase
    if (original === original.toUpperCase()) {
        return translation.toUpperCase();
    }

    // If the original word starts with uppercase
    if (original[0] === original[0].toUpperCase()) {
        return translation.charAt(0).toUpperCase() + translation.slice(1);
    }

    // Otherwise return translation as-is
    return translation;
}