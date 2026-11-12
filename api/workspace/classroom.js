/**
 * Google Classroom API Handler for Aliat Intel·ligent
 * Allows viewing courses, assignments (coursework), due dates, and materials,
 * plus importing coursework descriptions directly into study plans and tutoring sessions.
 */
module.exports = async function classroomHandler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token de Google Workspace necessari per accedir a Google Classroom.' });
    }

    const token = authHeader.split(' ')[1];

    try {
        if (req.method === 'GET') {
            const courseId = req.query.courseId;

            // If a specific courseId is requested, return coursework and announcements for that course
            if (courseId) {
                const [workRes, announceRes, materialsRes] = await Promise.all([
                    fetch(`https://classroom.googleapis.com/v1/courses/${encodeURIComponent(courseId)}/courseWork?pageSize=20&orderBy=dueDate desc`, {
                        headers: { Authorization: `Bearer ${token}` }
                    }),
                    fetch(`https://classroom.googleapis.com/v1/courses/${encodeURIComponent(courseId)}/announcements?pageSize=10`, {
                        headers: { Authorization: `Bearer ${token}` }
                    }),
                    fetch(`https://classroom.googleapis.com/v1/courses/${encodeURIComponent(courseId)}/courseWorkMaterials?pageSize=10`, {
                        headers: { Authorization: `Bearer ${token}` }
                    })
                ]);

                const workData = workRes.ok ? await workRes.json() : { courseWork: [] };
                const announceData = announceRes.ok ? await announceRes.json() : { announcements: [] };
                const materialsData = materialsRes.ok ? await materialsRes.json() : { courseWorkMaterial: [] };

                const coursework = (workData.courseWork || []).map(cw => ({
                    id: cw.id,
                    title: cw.title || '(Sense títol)',
                    description: cw.description || '',
                    dueDate: cw.dueDate ? `${cw.dueDate.day}/${cw.dueDate.month}/${cw.dueDate.year}` : null,
                    dueTime: cw.dueTime ? `${String(cw.dueTime.hours || 0).padStart(2, '0')}:${String(cw.dueTime.minutes || 0).padStart(2, '0')}` : null,
                    maxPoints: cw.maxPoints || 0,
                    workType: cw.workType || 'ASSIGNMENT',
                    alternateLink: cw.alternateLink || '',
                    state: cw.state || 'PUBLISHED'
                }));

                const announcements = (announceData.announcements || []).map(a => ({
                    id: a.id,
                    text: a.text || '',
                    creationTime: a.creationTime,
                    alternateLink: a.alternateLink || ''
                }));

                const materials = (materialsData.courseWorkMaterial || []).map(m => ({
                    id: m.id,
                    title: m.title || '',
                    description: m.description || '',
                    alternateLink: m.alternateLink || ''
                }));

                return res.status(200).json({
                    courseId,
                    coursework,
                    announcements,
                    materials
                });
            }

            // Otherwise, list active courses
            const coursesRes = await fetch(
                'https://classroom.googleapis.com/v1/courses?courseStates=ACTIVE&pageSize=20',
                {
                    headers: { Authorization: `Bearer ${token}` }
                }
            );

            if (!coursesRes.ok) {
                const errText = await coursesRes.text();
                return res.status(coursesRes.status).json({ error: 'Error obtenint cursos de Google Classroom', details: errText });
            }

            const data = await coursesRes.json();
            const courses = (data.courses || []).map(c => ({
                id: c.id,
                name: c.name || '(Classe sense nom)',
                section: c.section || '',
                descriptionHeading: c.descriptionHeading || '',
                room: c.room || '',
                alternateLink: c.alternateLink || 'https://classroom.google.com',
                courseState: c.courseState || 'ACTIVE'
            }));

            return res.status(200).json({ courses });
        }

        if (req.method === 'POST') {
            const {
                courseId,
                title = "Pla d'Estudis Aliat",
                description = "",
                dueDate, // { year, month, day }
                dueTime, // { hours, minutes }
                maxPoints = 100
            } = req.body || {};

            if (!courseId) {
                return res.status(400).json({ error: 'Cal especificar el curs (courseId) de Google Classroom.' });
            }

            const payload = {
                title: title.trim(),
                description: (description + "\n\nPlanificat i generat amb Aliat Intel·ligent.").trim(),
                workType: 'ASSIGNMENT',
                state: 'DRAFT',
                maxPoints: maxPoints || 100
            };

            if (dueDate && dueDate.year && dueDate.month && dueDate.day) {
                payload.dueDate = {
                    year: parseInt(dueDate.year, 10),
                    month: parseInt(dueDate.month, 10),
                    day: parseInt(dueDate.day, 10)
                };
                if (dueTime && dueTime.hours !== undefined) {
                    payload.dueTime = {
                        hours: parseInt(dueTime.hours, 10),
                        minutes: parseInt(dueTime.minutes || 0, 10)
                    };
                }
            }

            const createRes = await fetch(
                `https://classroom.googleapis.com/v1/courses/${encodeURIComponent(courseId)}/courseWork`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(payload)
                }
            );

            if (!createRes.ok) {
                const errText = await createRes.text();
                return res.status(createRes.status).json({
                    error: 'Error creant l\'esborrany de tasca a Google Classroom',
                    details: errText
                });
            }

            const createdWork = await createRes.json();
            return res.status(200).json({
                success: true,
                assignment: {
                    id: createdWork.id,
                    title: createdWork.title,
                    state: createdWork.state,
                    alternateLink: createdWork.alternateLink || `https://classroom.google.com/c/${courseId}`,
                    dueDate: createdWork.dueDate
                }
            });
        }

        return res.status(405).json({ error: 'Mètode no permès' });
    } catch (err) {
        console.error('[Classroom API Error]:', err);
        return res.status(500).json({ error: err.message || 'Error intern comunicant amb Google Classroom' });
    }
};
