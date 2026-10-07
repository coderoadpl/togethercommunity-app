import type { ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';
import { Box, Typography } from '@mui/material';
import { SurveyForm } from '../features/home/surveys/SurveyForm.js';
import { SurveyEditor } from '../features/home/surveys/SurveyEditor.js';
import { SurveyResults } from '../features/home/surveys/SurveyResults.js';
import { SurveyList } from '../features/home/surveys/SurveysPanel.js';
import { sampleResults, sampleSurvey } from '../features/home/surveys/survey-test-data.js';
import { withSurveyPreview } from './page-decorators.js';

const Preview = ({ children }: { children: ReactNode }) => <Box data-testid="story-survey">{children}</Box>;
const PublicPreview = ({ type = 'nps', ending }: { type?: 'nps' | 'stars'; ending?: number }) => <Preview><Box sx={{ py: { xs: 3, sm: 6 } }}><Typography variant="h3" sx={{ maxWidth: '48rem', mx: 'auto', mb: 4 }}>Community</Typography><SurveyForm survey={{ ...sampleSurvey, type }} onSubmit={() => undefined} endingHtml={ending === undefined ? undefined : `<p>${sampleSurvey.endings[ending]?.body ?? ''}</p>`} /></Box></Preview>;
const meta = { title: 'Surveys/NativeSurvey', decorators: [withSurveyPreview], parameters: { locale: 'en', colorScheme: 'light', layout: 'fullscreen' }, render: () => <PublicPreview />, play: async () => { await document.fonts.ready; } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
const selectStars: Story['play'] = async ({ canvasElement }) => {
  await document.fonts.ready;
  const button = within(canvasElement).getByRole('button', { name: 'Score 3' });
  await userEvent.click(button);
  await userEvent.unhover(button);
};

export const NpsFormLightDesktop: Story = { render: () => <PublicPreview />, parameters: { colorScheme: 'light' }, globals: { viewport: { value: 'desktop' } } };

export const NpsFormLightMobile: Story = { render: () => <PublicPreview />, parameters: { colorScheme: 'light' }, globals: { viewport: { value: 'mobile' } } };

export const NpsFormDarkDesktop: Story = { render: () => <PublicPreview />, parameters: { colorScheme: 'dark' }, globals: { viewport: { value: 'desktop' } } };

export const NpsFormDarkMobile: Story = { render: () => <PublicPreview />, parameters: { colorScheme: 'dark' }, globals: { viewport: { value: 'mobile' } } };

export const StarsFormLightDesktop: Story = { render: () => <PublicPreview type="stars" />, parameters: { colorScheme: 'light' }, globals: { viewport: { value: 'desktop' } }, play: selectStars };

export const StarsFormLightMobile: Story = { render: () => <PublicPreview type="stars" />, parameters: { colorScheme: 'light' }, globals: { viewport: { value: 'mobile' } }, play: selectStars };

export const StarsFormDarkDesktop: Story = { render: () => <PublicPreview type="stars" />, parameters: { colorScheme: 'dark' }, globals: { viewport: { value: 'desktop' } }, play: selectStars };

export const StarsFormDarkMobile: Story = { render: () => <PublicPreview type="stars" />, parameters: { colorScheme: 'dark' }, globals: { viewport: { value: 'mobile' } }, play: selectStars };

export const NpsEnding1LightDesktop: Story = { render: () => <PublicPreview type="nps" ending={0} />, parameters: { colorScheme: 'light' }, globals: { viewport: { value: 'desktop' } } };

export const NpsEnding1LightMobile: Story = { render: () => <PublicPreview type="nps" ending={0} />, parameters: { colorScheme: 'light' }, globals: { viewport: { value: 'mobile' } } };

export const NpsEnding1DarkDesktop: Story = { render: () => <PublicPreview type="nps" ending={0} />, parameters: { colorScheme: 'dark' }, globals: { viewport: { value: 'desktop' } } };

export const NpsEnding1DarkMobile: Story = { render: () => <PublicPreview type="nps" ending={0} />, parameters: { colorScheme: 'dark' }, globals: { viewport: { value: 'mobile' } } };

export const NpsEnding2LightDesktop: Story = { render: () => <PublicPreview type="nps" ending={1} />, parameters: { colorScheme: 'light' }, globals: { viewport: { value: 'desktop' } } };

export const NpsEnding2LightMobile: Story = { render: () => <PublicPreview type="nps" ending={1} />, parameters: { colorScheme: 'light' }, globals: { viewport: { value: 'mobile' } } };

export const NpsEnding2DarkDesktop: Story = { render: () => <PublicPreview type="nps" ending={1} />, parameters: { colorScheme: 'dark' }, globals: { viewport: { value: 'desktop' } } };

export const NpsEnding2DarkMobile: Story = { render: () => <PublicPreview type="nps" ending={1} />, parameters: { colorScheme: 'dark' }, globals: { viewport: { value: 'mobile' } } };

export const NpsEnding3LightDesktop: Story = { render: () => <PublicPreview type="nps" ending={2} />, parameters: { colorScheme: 'light' }, globals: { viewport: { value: 'desktop' } } };

export const NpsEnding3LightMobile: Story = { render: () => <PublicPreview type="nps" ending={2} />, parameters: { colorScheme: 'light' }, globals: { viewport: { value: 'mobile' } } };

export const NpsEnding3DarkDesktop: Story = { render: () => <PublicPreview type="nps" ending={2} />, parameters: { colorScheme: 'dark' }, globals: { viewport: { value: 'desktop' } } };

export const NpsEnding3DarkMobile: Story = { render: () => <PublicPreview type="nps" ending={2} />, parameters: { colorScheme: 'dark' }, globals: { viewport: { value: 'mobile' } } };

export const StarsEnding1LightDesktop: Story = { render: () => <PublicPreview type="stars" ending={0} />, parameters: { colorScheme: 'light' }, globals: { viewport: { value: 'desktop' } } };

export const StarsEnding1LightMobile: Story = { render: () => <PublicPreview type="stars" ending={0} />, parameters: { colorScheme: 'light' }, globals: { viewport: { value: 'mobile' } } };

export const StarsEnding1DarkDesktop: Story = { render: () => <PublicPreview type="stars" ending={0} />, parameters: { colorScheme: 'dark' }, globals: { viewport: { value: 'desktop' } } };

export const StarsEnding1DarkMobile: Story = { render: () => <PublicPreview type="stars" ending={0} />, parameters: { colorScheme: 'dark' }, globals: { viewport: { value: 'mobile' } } };

export const StarsEnding2LightDesktop: Story = { render: () => <PublicPreview type="stars" ending={1} />, parameters: { colorScheme: 'light' }, globals: { viewport: { value: 'desktop' } } };

export const StarsEnding2LightMobile: Story = { render: () => <PublicPreview type="stars" ending={1} />, parameters: { colorScheme: 'light' }, globals: { viewport: { value: 'mobile' } } };

export const StarsEnding2DarkDesktop: Story = { render: () => <PublicPreview type="stars" ending={1} />, parameters: { colorScheme: 'dark' }, globals: { viewport: { value: 'desktop' } } };

export const StarsEnding2DarkMobile: Story = { render: () => <PublicPreview type="stars" ending={1} />, parameters: { colorScheme: 'dark' }, globals: { viewport: { value: 'mobile' } } };

export const StarsEnding3LightDesktop: Story = { render: () => <PublicPreview type="stars" ending={2} />, parameters: { colorScheme: 'light' }, globals: { viewport: { value: 'desktop' } } };

export const StarsEnding3LightMobile: Story = { render: () => <PublicPreview type="stars" ending={2} />, parameters: { colorScheme: 'light' }, globals: { viewport: { value: 'mobile' } } };

export const StarsEnding3DarkDesktop: Story = { render: () => <PublicPreview type="stars" ending={2} />, parameters: { colorScheme: 'dark' }, globals: { viewport: { value: 'desktop' } } };

export const StarsEnding3DarkMobile: Story = { render: () => <PublicPreview type="stars" ending={2} />, parameters: { colorScheme: 'dark' }, globals: { viewport: { value: 'mobile' } } };

export const ListLightDesktop: Story = { render: () => <Preview><SurveyList surveys={[sampleSurvey]} onEdit={() => undefined} onResults={() => undefined} onToggle={() => undefined} onDelete={() => undefined} /></Preview>, parameters: { colorScheme: 'light' }, globals: { viewport: { value: 'desktop' } } };

export const ListLightMobile: Story = { render: () => <Preview><SurveyList surveys={[sampleSurvey]} onEdit={() => undefined} onResults={() => undefined} onToggle={() => undefined} onDelete={() => undefined} /></Preview>, parameters: { colorScheme: 'light' }, globals: { viewport: { value: 'mobile' } } };

export const ListDarkDesktop: Story = { render: () => <Preview><SurveyList surveys={[sampleSurvey]} onEdit={() => undefined} onResults={() => undefined} onToggle={() => undefined} onDelete={() => undefined} /></Preview>, parameters: { colorScheme: 'dark' }, globals: { viewport: { value: 'desktop' } } };

export const ListDarkMobile: Story = { render: () => <Preview><SurveyList surveys={[sampleSurvey]} onEdit={() => undefined} onResults={() => undefined} onToggle={() => undefined} onDelete={() => undefined} /></Preview>, parameters: { colorScheme: 'dark' }, globals: { viewport: { value: 'mobile' } } };

export const EditorLightDesktop: Story = { render: () => <Preview><SurveyEditor branding={<Typography variant="h3">Community</Typography>} survey={sampleSurvey} onSave={() => undefined} onCancel={() => undefined} /></Preview>, parameters: { colorScheme: 'light' }, globals: { viewport: { value: 'desktop' } } };

export const EditorLightMobile: Story = { render: () => <Preview><SurveyEditor branding={<Typography variant="h3">Community</Typography>} survey={sampleSurvey} onSave={() => undefined} onCancel={() => undefined} /></Preview>, parameters: { colorScheme: 'light' }, globals: { viewport: { value: 'mobile' } } };

export const EditorDarkDesktop: Story = { render: () => <Preview><SurveyEditor branding={<Typography variant="h3">Community</Typography>} survey={sampleSurvey} onSave={() => undefined} onCancel={() => undefined} /></Preview>, parameters: { colorScheme: 'dark' }, globals: { viewport: { value: 'desktop' } } };

export const EditorDarkMobile: Story = { render: () => <Preview><SurveyEditor branding={<Typography variant="h3">Community</Typography>} survey={sampleSurvey} onSave={() => undefined} onCancel={() => undefined} /></Preview>, parameters: { colorScheme: 'dark' }, globals: { viewport: { value: 'mobile' } } };

export const ResultsLightDesktop: Story = { render: () => <Preview><SurveyResults results={sampleResults} type="nps" onPage={() => undefined} onExport={() => undefined} /></Preview>, parameters: { colorScheme: 'light' }, globals: { viewport: { value: 'desktop' } } };

export const ResultsLightMobile: Story = { render: () => <Preview><SurveyResults results={sampleResults} type="nps" onPage={() => undefined} onExport={() => undefined} /></Preview>, parameters: { colorScheme: 'light' }, globals: { viewport: { value: 'mobile' } } };

export const ResultsDarkDesktop: Story = { render: () => <Preview><SurveyResults results={sampleResults} type="nps" onPage={() => undefined} onExport={() => undefined} /></Preview>, parameters: { colorScheme: 'dark' }, globals: { viewport: { value: 'desktop' } } };

export const ResultsDarkMobile: Story = { render: () => <Preview><SurveyResults results={sampleResults} type="nps" onPage={() => undefined} onExport={() => undefined} /></Preview>, parameters: { colorScheme: 'dark' }, globals: { viewport: { value: 'mobile' } } };
